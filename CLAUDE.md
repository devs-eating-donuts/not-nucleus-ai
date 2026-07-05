# Nucleus-AI — Project Guide

Electron + React + TypeScript desktop app that assigns locally installed AI coding
CLIs (Claude Code, Codex, Cursor, Antigravity, GitHub Copilot) to team roles
(Stakeholder, Project Lead, Architect, Developer, QA, Security, Ops) and runs a
Markdown-first, app-building workflow inside a bounded workspace folder.

**Identity:** a working productivity tool whose personas affectionately parody the TV
show *Silicon Valley*. It ships by default as an ORIGINAL, legally-distinct cast (see
`src/shared/naming.ts`); the show-accurate names are only a hidden fan's wink. Never
hardcode a persona/company name in UI or user-facing text — route it through
`personaDisplayName` / `effectivePersonaName` (`personas.ts`) or `brandName`
(`naming.ts`). The README carries the parody / fan-tribute disclaimer.

## Working principle — disagree freely

Push back. When an approach is wrong, weaker than an alternative, or adds needless
complexity, say so directly — with your reasoning and a recommended alternative — then
defer to the maintainer's call and execute it well. Honesty over agreement; the goal is
a genuinely better tool that ships working software, not validation.

## Commands

- `npm start` — dev app (Electron Forge + Vite, HMR)
- `npm run typecheck` — strict TS across main / preload / renderer / shared
- `npm test` — vitest (decision logic, parsers, path guard, sanitizers)
- `npm run package` / `npm run make` — Forge packaging / platform installers
- `npm run rebuild:pty` — build node-pty for Electron's ABI (see README; Windows needs VS 2022 Build Tools)

## Architecture rules (do not break)

- **Typed IPC only.** Channels + `NucleusApi` live in `src/shared/ipc.ts`; preload
  (`src/preload/api.ts`) exposes exactly that surface as `window.nucleus`. No generic
  invoke escape hatch. The renderer never touches Node / Electron APIs.
- **The main process owns everything privileged:** filesystem, subprocess, dialogs, PTY.
  Every IPC handler validates/sanitizes its inputs — the renderer is untrusted.
- **Markdown is the source of truth** for project workflow state (docs/, planning/,
  tasks/, reviews/, handoffs/ in each workspace). The `.nucleus/` JSON layer is app
  metadata only.
- **Workspace boundary:** all file access goes through `resolveWorkspacePath`
  (`src/main/services/markdownWorkspace.ts`, which rejects traversal). CLI execution
  stays inside the selected workspace folder.
- **Safe spawning:** `spawn(file, args)`, never shell strings. Windows `.cmd`/`.bat`
  shims run via an explicit `cmd.exe /d /s /c "<quoted path>"` (see `cliValidator.ts`).
- **Settings:** persisted by `settingsStore.ts` (sanitizing, atomic writes). The
  renderer mirrors via zustand with optimistic updates + debounced saves; never write an
  IPC response back over a newer local edit.
- **Theming:** semantic CSS tokens only (`styles/tokens.css`); themes switch via
  `data-theme`.

## State management

- Renderer state uses **Zustand**: one small store, sliced by domain (nav, settings,
  projects, conversations, whiteboard, bullpen). No Redux-style ceremony — update via `set`.
- The store holds **ephemeral UI state only**. It is NOT the source of truth for
  persisted/app data — that lives in the main process and is reached over `window.nucleus`.
- **Subscribe with selectors**, never the whole store.

## Conventions

- Strong types everywhere; small modules; no giant files.
- Pure / decision logic and the security boundaries get vitest coverage; UI changes get
  an `npm start` smoke check.
- Parody copy stays dry and professional. Persona names are legally-distinct originals by
  default; users can rename any seat.

## The lifecycle

A project moves through interactive rooms, each a project-scoped CLI session: Stakeholder
pitch → Project-Lead design → Architect plan (the user approves it) → an autonomous
Developer / QA / Security build loop (iteration budgets + escalate-to-human) → Ops docs.
The engines are `roomEngine`, `whiteboardEngine`, and `bullpenEngine` (with `bullpenPlan`
holding the pure decision logic); one shared `cliInvoker` runs every CLI (spawn or PTY)
the same way, so the engines never special-case a tool.
