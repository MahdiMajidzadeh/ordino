import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectClaudeCli } from '@main/providers/detect-claude'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })))
})

async function makeStubBinary(versionLine: string): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'ordino-claude-'))
  roots.push(dir)
  const bin = join(dir, 'claude')
  await fs.writeFile(bin, `#!/bin/sh\necho "${versionLine}"\n`)
  await fs.chmod(bin, 0o755)
  return bin
}

describe('detectClaudeCli', () => {
  it('honors a manual override and reads the version', async () => {
    const bin = await makeStubBinary('2.1.212 (Claude Code)')
    const result = await detectClaudeCli(bin)
    expect(result).toMatchObject({ installed: true, path: bin, version: '2.1.212', source: 'override' })
  })

  it('reports not-installed for a bad override without falling back', async () => {
    const result = await detectClaudeCli('/nonexistent/claude')
    expect(result).toEqual({ installed: false })
  })

  it(
    'detection on this machine finishes quickly and reports cleanly',
    { timeout: 30_000 },
    async () => {
      // Environment-dependent by nature: assert the shape and the bound, not
      // the outcome. Detection shells out, and an unbounded shell call once
      // hung this for fifteen minutes.
      const started = Date.now()
      const result = await detectClaudeCli()
      expect(Date.now() - started).toBeLessThan(25_000)
      if (result.installed) {
        expect(result.path).toBeTruthy()
        expect(['path', 'well-known']).toContain(result.source)
      } else {
        expect(result.path).toBeUndefined()
      }
    }
  )
})
