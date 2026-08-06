import type { OrdinoApi, Unsubscribe } from '@shared/ordino-api'
import type { IpcEventChannel, IpcEventMap, IpcInvokeMap } from '@shared/ipc-contract'
import type {
  AnalysisResult,
  ApplyResult,
  GlobalSettings,
  HistoryDetail,
  HistoryEntry,
  Plan,
  UndoAvailability
} from '@shared/types'
import { ok, err, type IpcResult } from '@shared/errors'
import { DEFAULT_STRATEGY } from '@shared/strategies'
import { DEFAULT_CLAUDE_MODEL } from '@shared/models'
import { getFixture, FIXTURE_SPECS } from './fixtures'

/**
 * Browser-only stand-in for the preload bridge: implements the full OrdinoApi
 * against fixtures with realistic latency and progress streams, so every
 * screen is buildable and demoable without the main process.
 *
 * Dev toolbar knobs live in localStorage:
 *   ordino.mock.fixture  — small | medium | large | dupes | rerun
 *   ordino.mock.fail     — '1' to make provider/analysis calls fail
 */
const FIXTURE_KEY = 'ordino.mock.fixture'
const FAIL_KEY = 'ordino.mock.fail'

export function currentMockFixtureId(): string {
  return localStorage.getItem(FIXTURE_KEY) ?? 'medium'
}

export function setMockFixtureId(id: string): void {
  localStorage.setItem(FIXTURE_KEY, id)
}

export function mockFailureEnabled(): boolean {
  return localStorage.getItem(FAIL_KEY) === '1'
}

export function setMockFailure(enabled: boolean): void {
  localStorage.setItem(FAIL_KEY, enabled ? '1' : '0')
}

export const MOCK_FIXTURE_IDS = FIXTURE_SPECS.map((s) => s.id)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Listener = (payload: unknown) => void

export function createMockOrdino(): OrdinoApi {
  const listeners = new Map<IpcEventChannel, Set<Listener>>()

  function emit<K extends IpcEventChannel>(channel: K, payload: IpcEventMap[K]): void {
    listeners.get(channel)?.forEach((cb) => cb(payload))
  }

  // ---- in-memory state ----------------------------------------------------
  let settings: GlobalSettings = {
    version: 1,
    provider: 'claude-cli',
    claude: { model: DEFAULT_CLAUDE_MODEL, cliPathOverride: '', hasApiKeyOverride: false },
    openaiCompat: { baseUrl: '', model: '', hasKey: false },
    ignoreGlobs: ['node_modules', '.git', '*.tmp'],
    lastStrategy: DEFAULT_STRATEGY
  }
  const history: HistoryEntry[] = []
  const historyOps = new Map<string, HistoryDetail>()
  let lastPlan: Plan | null = null
  let undoState: UndoAvailability = { available: false }
  const cancelled = new Set<string>()
  let opCounter = 0

  async function analysisFlow(req: IpcInvokeMap['analysis:start']['req']): Promise<IpcResult<AnalysisResult>> {
    const fixture = getFixture(currentMockFixtureId())
    if (fixture.scan.rerun && fixture.scan.rerun.nothingToDo && !req.reorganizeEverything) {
      return ok({ nothingToDo: true, rerun: fixture.scan.rerun })
    }
    const jobId = `mock-job-${Date.now()}`
    const skipped = new Set(
      Object.entries(req.inclusionChoices)
        .filter(([, choice]) => choice === 'skip')
        .map(([dir]) => dir)
    )
    const inScope = fixture.scan.files.filter(
      (f) => ![...skipped].some((s) => f.parentDir === s || f.parentDir.startsWith(`${s}/`))
    )
    const total = inScope.length
    // Mirrors the orchestrator's chunk size so batch counts look real.
    const chunkCount = total <= 200 ? 1 : Math.ceil(total / 150)

    // Duplicate hashing progress runs "in parallel" with analysis.
    const dupes = fixture.duplicateGroups
    void (async () => {
      const candidates = dupes.length * 2
      for (let i = 0; i <= candidates; i++) {
        if (cancelled.has(jobId)) return
        emit('duplicates:progress', {
          jobId,
          candidates,
          hashed: i,
          totalBytes: candidates * 5_000_000,
          hashedBytes: i * 5_000_000,
          done: i === candidates
        })
        await sleep(120)
      }
    })()

    emit('analysis:progress', {
      jobId,
      phase: 'preparing',
      filesAnalyzed: 0,
      filesTotal: total,
      chunk: { current: 0, total: chunkCount }
    })
    await sleep(400)

    // Real providers sit at 0 until the model's first streamed token — the
    // mock mirrors that so the "waiting for model" state stays demoable.
    emit('analysis:progress', {
      jobId,
      phase: 'analyzing',
      filesAnalyzed: 0,
      filesTotal: total,
      chunk: { current: 1, total: chunkCount }
    })
    await sleep(1200)

    const ticks = 14
    for (let i = 1; i <= ticks; i++) {
      if (cancelled.has(jobId)) return err('ANALYSIS_CANCELLED', 'cancelled', { retryable: true })
      emit('analysis:progress', {
        jobId,
        phase: 'analyzing',
        filesAnalyzed: Math.round((total * i) / ticks),
        filesTotal: total,
        chunk: { current: Math.min(chunkCount, 1 + Math.floor((chunkCount * i) / ticks)), total: chunkCount }
      })
      await sleep(200)
    }

    if (mockFailureEnabled()) {
      return err('PROVIDER_UNREACHABLE', 'Mock failure injection is on', { retryable: true })
    }

    emit('analysis:progress', {
      jobId,
      phase: 'assembling',
      filesAnalyzed: total,
      filesTotal: total,
      chunk: { current: chunkCount, total: chunkCount }
    })
    await sleep(300)

    const inScopeIds = new Set(inScope.map((f) => f.id))
    const { newFolders, moves } = fixture.planMovesFor(req.strategy)
    const scopedMoves = moves.filter((m) => inScopeIds.has(m.fileId))
    const movedIds = new Set(scopedMoves.map((m) => m.fileId))
    const organizedIds = req.reorganizeEverything ? [] : (fixture.scan.rerun?.organizedFileIds ?? [])
    const organizedSet = new Set(organizedIds)
    const plan: Plan = {
      planId: `mock-plan-${Date.now()}`,
      scanId: fixture.scan.scanId,
      rootPath: fixture.rootPath,
      strategy: req.strategy,
      newFolders,
      moves: scopedMoves,
      unchangedFileIds: inScope.filter((f) => !movedIds.has(f.id) && !organizedSet.has(f.id)).map((f) => f.id),
      organizedFileIds: organizedIds,
      duplicateGroups: dupes.filter((g) => g.fileIds.every((id) => inScopeIds.has(id))),
      warnings: []
    }
    lastPlan = plan
    return ok({ nothingToDo: false, plan })
  }

  async function applyFlow(req: IpcInvokeMap['apply:start']['req']): Promise<IpcResult<ApplyResult>> {
    const operationId = `mock-op-${++opCounter}`
    const total = req.moves.length + req.trash.length
    let done = 0
    for (const move of req.moves) {
      done += 1
      emit('apply:progress', {
        operationId,
        done,
        total,
        currentRelPath: move.source,
        stage: 'moving'
      })
      await sleep(Math.min(24, 2000 / Math.max(total, 1)))
    }
    for (const t of req.trash) {
      done += 1
      emit('apply:progress', { operationId, done, total, currentRelPath: t.path, stage: 'trashing' })
      await sleep(20)
    }

    // Fabricate one collision + one skip on bigger sets so Done has content.
    const collisions =
      req.moves.length > 30
        ? [
            {
              from: req.moves[3].source,
              requested: req.moves[3].destination,
              finalDestination: req.moves[3].destination.replace(/(\.[^.]+)$/, ' (1)$1')
            }
          ]
        : []
    const skipped =
      req.moves.length > 60
        ? [{ path: req.moves[9].source, reasonCode: 'locked' as const, detail: 'mock' }]
        : []

    const result: ApplyResult = {
      operationId,
      moved: req.moves.length - skipped.length,
      trashed: req.trash.length,
      skipped,
      failed: [],
      collisions
    }

    const fixture = getFixture(currentMockFixtureId())
    const entry: HistoryEntry = {
      id: operationId,
      rootPath: fixture.rootPath,
      rootName: fixture.scan.rootName,
      appliedAt: Date.now(),
      strategy: req.strategy,
      moved: result.moved,
      trashed: result.trashed,
      skipped: result.skipped.length,
      failed: 0,
      status: 'applied',
      undoable: true
    }
    for (const h of history) h.undoable = false
    history.unshift(entry)
    historyOps.set(operationId, {
      ...entry,
      ops: [
        ...req.moves.map((m) => ({ kind: 'move' as const, from: m.source, to: m.destination, status: 'moved' })),
        ...req.trash.map((t) => ({ kind: 'trash' as const, from: t.path, status: 'staged' }))
      ]
    })
    undoState = {
      available: true,
      operationId,
      appliedAt: entry.appliedAt,
      moveCount: req.moves.length,
      trashCount: req.trash.length
    }
    return ok(result)
  }

  async function invoke<K extends keyof IpcInvokeMap>(
    channel: K,
    req: IpcInvokeMap[K]['req']
  ): Promise<IpcResult<IpcInvokeMap[K]['res']>> {
    type Res<C extends keyof IpcInvokeMap> = IpcResult<IpcInvokeMap[C]['res']>
    const fixture = getFixture(currentMockFixtureId())

    switch (channel) {
      case 'dialog:pickFolder': {
        await sleep(250)
        return ok(fixture.rootPath) as Res<K>
      }
      case 'scan:quick': {
        await sleep(200)
        return ok(fixture.quick) as Res<K>
      }
      case 'scan:folder': {
        await sleep(400)
        return ok(fixture.scan) as Res<K>
      }
      case 'analysis:start':
        return (await analysisFlow(req as IpcInvokeMap['analysis:start']['req'])) as Res<K>
      case 'job:cancel': {
        cancelled.add((req as IpcInvokeMap['job:cancel']['req']).jobId)
        return ok(undefined) as Res<K>
      }
      case 'apply:start':
        return (await applyFlow(req as IpcInvokeMap['apply:start']['req'])) as Res<K>
      case 'undo:status':
        return ok(undoState) as Res<K>
      case 'undo:last': {
        if (!undoState.available || !undoState.operationId) {
          return err('UNDO_NOT_AVAILABLE', 'nothing to undo') as Res<K>
        }
        const opId = undoState.operationId
        const count = (undoState.moveCount ?? 0) + (undoState.trashCount ?? 0)
        for (let i = 1; i <= Math.min(count, 40); i++) {
          emit('apply:progress', {
            operationId: opId,
            done: i,
            total: Math.min(count, 40),
            currentRelPath: '…',
            stage: 'restoring'
          })
          await sleep(30)
        }
        const entry = history.find((h) => h.id === opId)
        if (entry) {
          entry.status = 'undone'
          entry.undoable = false
        }
        undoState = { available: false }
        return ok({
          operationId: opId,
          restored: count,
          restoredFromTrash: 0,
          removedFolders: lastPlan?.newFolders.length ?? 0,
          notRestored: []
        }) as Res<K>
      }
      case 'history:list':
        return ok([...history]) as Res<K>
      case 'history:get': {
        const { operationId } = req as IpcInvokeMap['history:get']['req']
        const detail = historyOps.get(operationId)
        return (detail ? ok(detail) : err('INTERNAL', 'unknown operation')) as Res<K>
      }
      case 'export:plan': {
        await sleep(500)
        return ok({ savedPath: '/Users/demo/Desktop/ordino-plan.json' }) as Res<K>
      }
      case 'settings:get':
        return ok(settings) as Res<K>
      case 'settings:set': {
        const patch = req as IpcInvokeMap['settings:set']['req']
        settings = {
          ...settings,
          ...patch,
          claude: { ...settings.claude, ...(patch.claude ?? {}) },
          openaiCompat: { ...settings.openaiCompat, ...(patch.openaiCompat ?? {}) }
        }
        return ok(settings) as Res<K>
      }
      case 'secrets:setKey': {
        const { provider } = req as IpcInvokeMap['secrets:setKey']['req']
        if (provider === 'claude-cli') settings.claude.hasApiKeyOverride = true
        else settings.openaiCompat.hasKey = true
        return ok(undefined) as Res<K>
      }
      case 'secrets:clearKey': {
        const { provider } = req as IpcInvokeMap['secrets:clearKey']['req']
        if (provider === 'claude-cli') settings.claude.hasApiKeyOverride = false
        else settings.openaiCompat.hasKey = false
        return ok(undefined) as Res<K>
      }
      case 'provider:detectClaude': {
        await sleep(350)
        return ok({
          installed: true,
          path: '/usr/local/bin/claude',
          version: '2.1.0',
          source: 'path' as const
        }) as Res<K>
      }
      case 'provider:testConnection': {
        await sleep(800)
        if (mockFailureEnabled()) {
          return err('PROVIDER_UNREACHABLE', 'Mock failure injection is on', { retryable: true }) as Res<K>
        }
        return ok({ latencyMs: 812, model: 'mock-model' }) as Res<K>
      }
      case 'provider:listModels': {
        await sleep(600)
        const r = req as IpcInvokeMap['provider:listModels']['req']
        if (r.provider === 'claude-cli') {
          return ok({ models: ['sonnet', 'haiku', 'opus'], source: 'curated' as const }) as Res<K>
        }
        if (mockFailureEnabled()) return err('PROVIDER_BAD_ENDPOINT', 'mock') as Res<K>
        return ok({
          models: ['llama3.2', 'qwen2.5:14b', 'mistral-nemo'],
          source: 'endpoint' as const
        }) as Res<K>
      }
      case 'prefs:getFolder':
        return ok(null) as Res<K>
      case 'prefs:setFolder':
        return ok(undefined) as Res<K>
      case 'recents:list':
        return ok([
          {
            path: fixture.rootPath,
            name: fixture.scan.rootName,
            lastUsedAt: Date.now() - 3 * 86400_000,
            hasManifest: fixture.scan.rerun !== null
          },
          {
            path: '/Users/demo/Documents/Inbox',
            name: 'Inbox',
            lastUsedAt: Date.now() - 12 * 86400_000,
            hasManifest: false
          }
        ]) as Res<K>
      case 'updates:check':
        return ok({ state: 'none' as const }) as Res<K>
      case 'updates:install':
        return ok(undefined) as Res<K>
      default:
        return err('INTERNAL', `Mock has no handler for ${String(channel)}`) as Res<K>
    }
  }

  return {
    invoke,
    on: (channel, cb) => {
      let set = listeners.get(channel)
      if (!set) {
        set = new Set()
        listeners.set(channel, set)
      }
      set.add(cb as Listener)
      const unsubscribe: Unsubscribe = () => set.delete(cb as Listener)
      return unsubscribe
    },
    getPathForFile: () => getFixture(currentMockFixtureId()).rootPath
  }
}
