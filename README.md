# Ordino

AI-powered file organizer for the desktop. Point Ordino at a messy folder, pick a strategy, review a visual before/after plan, and apply it with one click — with full undo.

Built with Electron, React, TypeScript, Tailwind and Zustand. See [requirements.md](requirements.md) for the full product spec.

## How it works

1. **Add a folder** (picker or drag-and-drop). Ordino scans it locally and shows what's inside.
2. **Choose subfolders** to include or skip (skipped folders are never touched, but can still be used as destinations).
3. **Pick a strategy** — Smart Categories (AI), File Type, Date, or a free-text Custom Instruction.
4. **Review the plan** in a side-by-side before/after tree with connector lines, per-file include toggles, group approve/reject, reassignment, and a duplicates panel.
5. **Apply.** Every operation is journaled before the first move; a single click **undoes** the whole thing.

Re-running Ordino on an organized folder only analyzes new files, reuses the existing structure, and short-circuits with "Already organized — nothing to do" (zero AI calls) when there's nothing to organize.

## Privacy

**Ordino sends file names and metadata to your chosen AI provider — never file contents.** Duplicate detection (size + SHA-256) runs entirely locally; hashes never leave the machine. With a local endpoint (e.g. Ollama), nothing leaves the machine at all.

The Claude backend runs the model with **every tool disabled** and an empty working directory — the model can only ever see the manifest Ordino sends it.

## AI backends

| Backend | Setup |
|---|---|
| **Claude Code** (default) | Uses the `claude` CLI already installed on your machine, with its existing sign-in. Optional Anthropic API key override (stored in the OS keychain). |
| **OpenAI-compatible** | Any Chat Completions endpoint: OpenAI, OpenRouter, or local models via Ollama/LM Studio (`http://localhost:11434/v1`, no key). Models are listed from the endpoint's `/models` route with manual entry as fallback. |

## Per-folder state

Everything Ordino knows about a folder lives *inside* that folder, under `.ordino/`:

- `journal.json` — append-only change log; powers undo and the History screen
- `manifest.json` — organized-state manifest; powers incremental re-runs
- `settings.json` — remembered strategy and subfolder choices
- `trash/` — staged duplicate removals while undo is still possible (they move to the OS Trash when the undo window closes; nothing is ever hard-deleted)

State travels with the folder — rename or move it and Ordino still recognizes it. Machine-level settings (provider config, API keys, recent folders) live in the app's user-data directory; keys are encrypted with the OS keychain via `safeStorage`.

## Development

```bash
npm install
npm run dev        # Electron with HMR
npm test           # vitest unit + integration suite
npm run typecheck
```

The renderer runs against a **mock API** when opened in a plain browser (`http://localhost:5173` while `npm run dev` is up) — every screen is demoable without the main process. Use the `mock` toolbar (bottom-left) to switch fixtures (20 / 200 / 5,000 files, duplicates-heavy, re-run) and inject failures.

A live end-to-end test (real Claude Code, real files, apply + undo) is gated behind an env var because it costs tokens:

```bash
RUN_CLAUDE_LIVE=1 npx vitest run tests/claude-live.test.ts
```

### Building installers

```bash
npm run build:mac    # dmg + zip
npm run build:win    # nsis
npm run build:linux  # AppImage + deb
```

Signing/notarization are scaffolded but disabled until certificates are configured — see the placeholders in [electron-builder.yml](electron-builder.yml) and [.github/workflows/build.yml](.github/workflows/build.yml). Auto-update (electron-updater) is wired to GitHub Releases and activates in packaged builds.

### Cutting a release

Pushing a `v*` tag is the whole process:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

CI stamps `package.json` with the tag (so the version the app reports in Settings → About is the tag it was built from), builds the macOS `.dmg` for both Intel and Apple Silicon plus the Windows and Linux installers, uploads them to a draft GitHub release, and publishes that release once every installer is in place. The tag must be valid semver — `v0.2.0`, not `release-2`.

## Architecture notes

- `src/shared/` — the typed IPC contract (`ipc-contract.ts`, `ordino-api.ts`) both processes compile against; contract drift between the mock and main is a compile error.
- `src/main/` — all filesystem and AI work: scanner, duplicate detector, provider orchestrator (chunking + one repair round-trip for malformed model output), plan validator (path confinement, no renames, sanitization), journal-first apply engine, undo, manifest differ.
- `src/renderer/` — wizard state machine (Zustand), virtualized trees (fixed 28px rows — the connector overlay computes line endpoints from virtualizer math, no DOM reads), locale file for every string (RTL-ready).
- Every request from the renderer is zod-validated in main, and renderer-edited plans are fully re-validated at apply time.
