# Ordino — AI-Powered File Organizer

**Working title:** Ordino (alternatives: Tidyr, FileSage, Shelfie)
**Platform:** Desktop (Electron) — macOS, Windows, Linux
**AI Engine:** Claude Agent SDK
**Status:** Draft v1.0 — 2026-08-07

---

## 1. Problem Statement

Folders accumulate hundreds of unsorted files — downloads, exports, screenshots, documents — and manually organizing them is tedious enough that most people never do it. Existing auto-organizers use rigid rule engines (extension → folder) that miss semantic meaning: `invoice-digikala-march.pdf` and `receipt_2026.pdf` belong together regardless of naming pattern. The cost of not solving it: wasted time searching, duplicated files, and cluttered workspaces that degrade over time.

Ordino lets a user point at a folder, choose an organization strategy, review an AI-generated plan, and apply it with one click — with full undo.

## 2. Goals

1. A user can go from "messy folder" to "organized folder" in under 2 minutes for a folder of ~200 files.
2. Zero destructive surprises: no file is ever moved without an explicit, reviewable confirmation.
3. Every apply operation is fully reversible via one-click undo.
4. Organization quality is semantic (AI-driven), not just extension-based — files are grouped by inferred purpose/category from names and metadata.
5. The app feels like a modern native tool: fast, clean, minimal chrome.
6. Duplicate files are detected during analysis and surfaced in the review screen, so organizing a folder also cleans it up — the user decides per duplicate whether to keep or remove.
7. Re-runs are idempotent and incremental: running Ordino again on an organized folder touches only new files, reuses the existing structure, and costs nothing (no AI call) when there's nothing to do.

## 3. Non-Goals (v1)

- **Reading file contents.** v1 analyzes file names + metadata only (name, extension, size, created/modified dates). Content analysis (PDF text, image OCR) is a P2 future consideration — it changes the privacy, performance, and cost profile significantly.
- **Continuous/background watching.** v1 is on-demand only. No daemon that auto-organizes as files arrive.
- **Cloud sync or multi-device state.** Local-only app, local-only history.
- **Renaming files.** v1 moves files into folders; it does not rename them. Renaming introduces link-breaking risk and doubles the review surface.
- **Automatic duplicate deletion/merging.** Duplicates are *detected and flagged* (see Goal 6), but Ordino never deletes or merges them automatically — removal is always a per-file user decision, and deleted duplicates go to the OS trash, never hard-delete.
- **Multi-folder batch jobs.** One root folder per session in v1.

## 4. User Stories

Ordered by priority:

1. As a user, I want to add a folder (via picker or drag-and-drop) so that Ordino can analyze its contents.
2. As a user, I want to choose *how* files get organized (by category, by file type, by date, by project, or a custom instruction) so that the result matches my mental model.
3. As a user, I want a rich, graphical before/after visualization — side-by-side folder trees showing exactly where every file moves — so that I can trust what will happen before anything changes on disk.
4. As a user, I want to approve or reject individual moves in the plan so that I stay in control of edge cases the AI gets wrong.
5. As a user with nested folders, I want to be asked whether each subfolder should be included so that already-organized subfolders are left alone.
6. As a returning user, I want re-running Ordino on the same folder to leave already-organized files alone and only organize what's new, so that maintenance runs are fast and never churn my existing structure.
7. As a user, I want to undo the last apply operation completely so that a bad result costs me nothing.
8. As a user, I want to see progress while the AI analyzes a large folder so that the app never feels frozen.
9. As a user, I want duplicates found during analysis to be flagged in the review screen so that I can choose which copy to keep and send the rest to trash.
10. As a user, I want the app to skip files it can't safely move (locked, in use, permission denied) and tell me why, so that a single problem file doesn't fail the whole operation.

## 5. Core User Flow

```
Add folder → (Re-run? diff vs. organized manifest) → Subfolder inclusion prompts →
Choose strategy → AI analysis on unorganized files only (progress) →
Review plan (graphical before/after) → Confirm → Apply (moves files) →
Summary + Undo available + manifest updated
```

### 5.1 Add Folder
- Folder picker button + drag-and-drop target on the home screen.
- On selection, Ordino scans the tree (non-recursive first level) and shows: file count, subfolder count, total size.

### 5.2 Subfolder Inclusion
- If the root folder contains subfolders, Ordino lists them with a per-folder **Include / Skip** toggle (with "Include all" / "Skip all" shortcuts).
- Recursion applies per included subfolder: if an included subfolder itself contains subfolders, the same prompt repeats for that level (or a tree view with checkboxes covers all levels at once — see Open Questions).
- Skipped subfolders are treated as opaque: their contents are never read or moved, but the subfolder itself may be referenced as an existing destination.

### 5.3 Organization Strategy
User selects one strategy before analysis:

| Strategy | Behavior |
|---|---|
| **Smart Categories** (default) | AI infers semantic categories from file names/metadata (e.g., Invoices, Screenshots, 3D Models, Code, Music) and creates folders accordingly |
| **File Type** | Groups by extension family (Documents, Images, Video, Audio, Archives, Code, Other) |
| **Date** | Groups by created/modified date — user picks granularity (Year / Year-Month) |
| **Custom Instruction** | Free-text prompt passed to the agent, e.g., "separate work files from personal, put anything 3D-printing related in one folder" |

- Strategy options: prefer existing subfolders as destinations vs. always create new folders (toggle, default: reuse existing where they fit).

### 5.4 AI Analysis

**Provider selection.** Ordino supports two interchangeable AI backends, selected in Settings:

1. **Claude Agent SDK** (default, recommended) — full agentic analysis via Anthropic. User supplies an Anthropic API key; model selectable from a curated list (e.g., Sonnet as default, Haiku for speed/cost).
2. **OpenAI-compatible API** — any endpoint implementing the OpenAI Chat Completions format: OpenAI itself, OpenRouter, local models (Ollama, LM Studio), or self-hosted proxies. User configures: **base URL**, **API key** (optional for local endpoints), and **model** — chosen from a dropdown populated via the endpoint's `/models` route when available, with manual text entry as fallback.

**In-app help.** Each provider option has an inline help panel with step-by-step setup instructions: where to get an Anthropic key; how to point at OpenAI/OpenRouter; how to connect a local Ollama instance (example base URL `http://localhost:11434/v1`, no key needed). A **Test connection** button validates URL/key/model before saving and shows a plain-language error on failure.

**Analysis behavior (identical for both providers):**
- The model receives the file manifest (paths, names, extensions, sizes, dates — **never file contents** in v1) plus the chosen strategy.
- Returns a structured plan: `[{ source, destination, reason }]` and a list of proposed new folders, validated against the same JSON schema regardless of provider.
- Streaming progress UI: files analyzed / total, current phase.
- Batching: large folders (>500 files) are chunked into multiple calls; the plan is assembled client-side.
- Provider differences are isolated behind a single internal `OrganizerProvider` interface, so plan quality may vary by model but the app flow never does.
- **Duplicate detection (local):** in parallel with the AI call, Ordino detects duplicates locally — first by size match, then by content hash (SHA-256) of size-matched candidates. Hashing is fully local; hashes and contents are never sent to the API, so the privacy stance is unchanged.

### 5.5 Review & Confirm (the graphical before/after view)
This is the heart of the app — a visual, not textual, experience.

- **Side-by-side folder trees:** left pane shows the current structure, right pane the proposed structure, rendered as graphical trees with file-type icons, folder icons, and item counts — not a flat text list.
- **Visual linking:** hovering/selecting a file highlights it in both panes and draws a connector line (or animated arrow) from its current location to its destination.
- **Color coding:** new folders (green), files being moved (accent highlight), unchanged files (dimmed), flagged duplicates (amber).
- **Detail on demand:** clicking any file opens a small card with from → to path and the AI's one-line reason; the tree itself stays uncluttered.
- Per-item checkbox (default checked). Unchecked items are excluded from apply and their connector/highlight disappears immediately, so the right pane always previews the exact end state.
- Group-level actions: approve/reject an entire proposed folder.
- Ability to reassign a file to a different proposed folder via drag or dropdown.
- **Duplicates section:** files detected as duplicates (see 5.4) are grouped, with the recommended keeper pre-selected; per-file choice of Keep / Move to trash. Default for all duplicates is Keep — trashing is always opt-in.
- Summary bar: "42 files → 6 folders (2 new) · 3 duplicates flagged". Nothing on disk changes until **Apply** is clicked.

### 5.6 Apply & Undo
- Apply executes moves transactionally-in-spirit: an operation journal is written *before* the first move (`ordino-history.json` in app data, not in the user's folder).
- Name collisions at destination: auto-suffix (`file (1).ext`) and flag in the summary.
- Files that fail to move (locked/permissions) are skipped and reported; the rest proceed.
- Post-apply summary: moved / skipped / failed counts + **Undo** button.
- **Undo** reverses the last apply: every moved file returns to its original path; folders created by Ordino that are now empty are removed. Undo is available until the next apply operation (single-level undo, journal retained as a log).
- If a file was modified/moved by the user after apply, undo skips it and reports it.

### 5.7 Re-runs (incremental organization)
Running Ordino again on a previously organized folder must be cheap, fast, and non-destructive:

- **Organized-state manifest:** after every successful apply, Ordino records each organized file (destination path + size + modified date) and each Ordino-managed folder in a per-root-folder manifest stored in app data (never inside the user's folder).
- **Re-run scan diff:** on re-run, the scan compares the current tree against the manifest:
  - **Leave alone:** files still at their organized destination (even if modified in place) and Ordino-managed folders — excluded from the plan entirely, shown dimmed in the review tree.
  - **Organize:** new files, and files the manifest doesn't recognize (added, or moved out of place by the user).
- **Structure reuse:** the AI receives the existing Ordino-managed folder structure as preferred destinations, so a second run slots new files into the categories from the first run instead of inventing a parallel scheme. New folders are only proposed when nothing existing fits.
- **Fast path:** if the diff finds nothing to organize, Ordino says "Already organized — nothing to do" without an AI call.
- **Full re-organize (escape hatch):** an explicit "Re-organize everything" option ignores the manifest and treats the folder as fresh — clearly labeled, never the default.
- Strategy changes: if the user picks a different strategy than the manifest was built with, Ordino warns that mixing strategies may produce inconsistent structure and offers Full re-organize as the alternative.

## 6. Requirements

### Must-Have (P0)

**P0-1: Folder selection**
- [ ] User can add a folder via native picker or drag-and-drop
- [ ] App displays file count, subfolder count, and total size after scan
- [ ] Hidden/system files (e.g., `.DS_Store`, `Thumbs.db`, `desktop.ini`) are excluded automatically

**P0-2: Subfolder inclusion prompt**
- Given a root folder containing subfolders
- When the scan completes
- Then the user is shown each subfolder with an Include/Skip choice, and skipped folders' contents are never touched

**P0-3: Strategy selection**
- [ ] All four strategies (Smart Categories, File Type, Date, Custom Instruction) selectable before analysis
- [ ] Custom Instruction accepts free text and is passed verbatim to the agent

**P0-4: AI plan generation (dual provider)**
- [ ] Two selectable backends: Claude Agent SDK (default) and OpenAI-compatible API (custom base URL + API key + model selector)
- [ ] Model dropdown populated from the endpoint's `/models` route where available, with manual entry fallback
- [ ] Inline setup instructions for each provider and a **Test connection** validator with plain-language errors
- [ ] Model receives only names + metadata, never file contents — regardless of provider
- [ ] Plan output validated against the same JSON schema and the actual file manifest for both providers (no non-existent files, no paths outside the root folder)
- [ ] API/network failures produce a clear retryable error, never a partial silent plan

**P0-5: Review before apply (graphical)**
- Given a generated plan
- When the user views it
- Then the current and proposed structures are shown as side-by-side graphical folder trees, every move is visually traceable from source to destination, and no filesystem change occurs before explicit confirmation
- [ ] File-type icons, color coding (new folders / moved / unchanged / duplicates), and hover-linking between panes
- [ ] Per-file include/exclude toggles, with the proposed tree updating live to reflect exclusions
- [ ] Nothing is applied if the user cancels or closes the window

**P0-6: Safe apply**
- [ ] Operation journal written before any move
- [ ] Name collisions resolved via suffixing, reported in summary
- [ ] Locked/permission-failed files skipped and reported, remaining moves proceed
- [ ] Moves stay within the selected root folder — no writes anywhere else on disk

**P0-7: Full undo of last operation**
- Given an apply has completed
- When the user clicks Undo
- Then all moved files return to their original paths, Ordino-created empty folders are removed, and any files that can't be restored are listed with reasons
- [ ] Undo survives an app restart (journal persisted to disk)

**P0-8: Duplicate detection & handling**
- [ ] Duplicates detected locally via size match + SHA-256 content hash — no file contents or hashes sent to the API
- [ ] Duplicate groups shown in the review screen with a recommended keeper; default action is Keep for all copies
- Given the user marks a duplicate for removal and clicks Apply
- When the apply runs
- Then that file is moved to the OS trash (never hard-deleted) and the action is recorded in the operation journal
- [ ] Undo restores trashed duplicates to their original paths along with moved files

**P0-9: Incremental re-runs**
- Given a folder Ordino has organized before
- When the user runs Ordino on it again
- Then files still at their organized destinations and Ordino-managed folders are excluded from the plan, and only new/unrecognized files are analyzed and proposed for moves
- [ ] Organized-state manifest per root folder, persisted in app data and updated after every apply and undo
- [ ] Existing Ordino-created folders passed to the AI as preferred destinations; new folders proposed only when nothing fits
- [ ] "Already organized — nothing to do" fast path with no AI call when the diff is empty
- [ ] Explicit, clearly-labeled "Re-organize everything" option that bypasses the manifest; never the default

**P0-10: UI/UX baseline**
- [ ] Clean, modern, minimal interface (single-window flow, light + dark mode following OS)
- [ ] Progress indication for scan, analysis, and apply phases
- [ ] English UI

### Nice-to-Have (P1)

- **P1-1:** Reassign a file to a different destination in the review screen (dropdown or drag)
- **P1-2:** Operation history screen (read-only log of past applies, even though only the last is undoable)
- **P1-3:** "Dry-run export" — save the plan as JSON/Markdown without applying
- **P1-4:** Remember last-used strategy and per-folder preferences
- **P1-5:** Keyboard navigation in the review list (j/k, space to toggle)
- **P1-6:** Configurable ignore patterns (glob), e.g., `node_modules`, `*.tmp`

### Future Considerations (P2)

- **P2-1: Content-aware analysis** — opt-in reading of text/PDF/doc contents for higher-quality categorization. Architect the agent input schema now so a `contentExcerpt` field can be added without breaking the plan format.
- **P2-2: Multi-level undo** — journal format should be an append-only list of operations from day one, even though v1 only exposes the last.
- **P2-3: Watch mode** — background organization of a folder as files arrive.
- **P2-4: File renaming suggestions** as a separate, individually-confirmed step.
- **P2-5: Persian/RTL localization** — keep all strings in a locale file from v1 so this is a translation task, not a refactor.

## 7. Technical Architecture

### Stack
- **Shell:** Electron (latest LTS), context isolation on, `nodeIntegration` off
- **Renderer:** React + TypeScript, Tailwind CSS; state via Zustand (or equivalent lightweight store)
- **Main process:** All filesystem operations and all Claude Agent SDK calls live in the main process; renderer communicates via typed IPC only
- **AI:** Pluggable `OrganizerProvider` interface with two implementations: Claude Agent SDK (default) and a generic OpenAI-compatible client (configurable base URL + model). Both propose a plan; neither ever executes moves itself. All provider calls live in the main process.
- **Persistence:** JSON in Electron `userData` (settings, operation journal/history, per-folder organized-state manifests)

### Agent design
- Input: strategy, root path (relative form), file manifest `[{ relPath, name, ext, size, createdAt, modifiedAt }]`, list of existing included subfolders
- Output contract (strict JSON, schema-validated):
  ```json
  {
    "newFolders": ["Invoices", "3D Models"],
    "moves": [
      { "source": "rel/path/file.pdf", "destination": "Invoices/file.pdf", "reason": "..." }
    ]
  }
  ```
- Every agent response is validated: unknown source paths dropped, destinations normalized and confined to root, path traversal (`..`) rejected.
- Chunking for large manifests; category consistency maintained by passing already-decided folder names into subsequent chunks.

### Security & privacy
- No file contents leave the machine in v1 — only names/metadata are sent to the configured AI endpoint. State this explicitly in the UI ("Ordino sends file names, not file contents"). With a local OpenAI-compatible endpoint (e.g., Ollama), nothing leaves the machine at all — call this out in the provider help.
- All provider API keys stored in OS keychain (via `safeStorage`/keytar), never in plaintext config; base URL and model stored in settings.
- All destructive operations gated behind renderer-initiated, user-confirmed IPC calls.

### Performance targets
- Scan of 1,000 files: < 2s
- Plan generation for 200 files: < 30s (streamed progress)
- Apply of 200 moves: < 5s
- Duplicate hashing runs in parallel with the AI call and only on size-matched candidates, so it adds no perceived latency for typical folders
- UI never blocks: all FS and API work off the renderer thread

## 8. UX / Visual Direction

- Single-window, wizard-like flow with a persistent step indicator (Folder → Options → Review → Done)
- Generous whitespace, one accent color, system font stack; no skeuomorphism, no dense toolbars
- The graphical before/after review is the signature screen: side-by-side trees, connector lines, and color coding should make the plan understandable at a glance without reading a single path string — calm, scannable, obviously safe
- Empty states and errors written in plain language with a suggested next action

## 9. Success Criteria (v1)

- **Task completion:** a first-time user organizes a test folder (150 mixed files) without documentation in < 3 minutes
- **Plan acceptance:** ≥ 80% of AI-proposed moves accepted unmodified in dogfooding on real folders
- **Safety:** zero data-loss incidents; undo restores 100% of unmodified files in testing
- **Reliability:** apply completes or cleanly reports partial failure on folders up to 5,000 files

## 10. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| 1 | Subfolder inclusion UX: sequential per-level prompts vs. a single tree view with checkboxes upfront? Tree view is likely better for deep trees but heavier to build. | Design | Yes — shapes the scan flow |
| 2 | Should skipped subfolders be usable as *destinations* (e.g., move loose photos into an existing skipped `Photos/` folder)? Current spec says yes-by-reference; confirm. | Product | Yes |
| 3 | For the Claude backend: user-supplied API key vs. Claude Pro/Max OAuth via Agent SDK? (OpenAI-compatible path is always key/URL-based.) | Engineering | No |
| 3b | Structured-output reliability on arbitrary OpenAI-compatible models: enforce via JSON mode where supported, and define retry/repair behavior for models that return malformed plans. | Engineering | Yes |
| 4 | Symlinks and shortcuts: skip, follow, or move-the-link? Proposal: never follow; move the link file itself. | Engineering | No |
| 5 | Very large folders (10k+ files): hard cap with a warning, or paginated multi-pass organization? | Engineering | No |
| 6 | Final product name and whether the domain/App Store name is available. | Product | No |
| 7 | Re-run edge case: if the user renamed or reshuffled Ordino-created folders between runs, should the manifest track folders by identity (and adopt the renames) or treat the renamed structure as user-owned and organize new files around it? Proposal: treat renamed folders as user-owned existing destinations. | Product | No |

## 11. Phasing

- **Phase 1 (MVP):** P0-1 → P0-10. Smart Categories + File Type strategies only. Single-level folders (no nested subfolder recursion beyond one level).
- **Phase 2:** Date + Custom Instruction strategies, full nested recursion, P1-1/P1-2/P1-3.
- **Phase 3:** P1-4/P1-5/P1-6, packaging + auto-update, code signing for macOS/Windows.
