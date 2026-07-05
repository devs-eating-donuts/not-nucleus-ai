# Nucleus-AI

*Assign the AI coding CLIs you already have to a product team of personas — and let them build a real app together, start to finish.*

**Powered by Hoolisoft · Created by Pipeline Labs**

---

## What it is

Nucleus-AI is a desktop app (Electron + React + TypeScript) that turns the AI coding CLIs you
already have installed — **Claude Code, Codex, Cursor, GitHub Copilot, Antigravity** — into a
**product team**. You assign each CLI to a role, and the app runs the whole team through a real
software lifecycle inside a folder you choose.

The seven roles (shown here with their default, legally-distinct persona names):

| Role | Persona | What they do |
|------|---------|--------------|
| Stakeholder | Erlich | Hears your pitch and decides if it's worth building |
| Project Lead | Monica | Does the real design work with you — stack, hosting, how it works |
| Architect | Richard | Turns the design into concrete phases and tasks; you approve the plan |
| Developer | Dinesh | Builds the tasks |
| QA | Big Head | Tests each task; failures bounce back to the developer |
| Security | Gilfoyle | Reviews trust boundaries; real findings become fix tasks |
| Ops | Jared | Writes the docs and tracks how the build went |

## What it does

You take an idea from a pitch to a working application, one governed stage at a time:

1. **The Pitch** — pitch your idea to Erlich; he decides if it enters his incubator.
2. **Investor Pitch** — Monica designs it with you: stack, hosting, the concrete decisions.
3. **The Whiteboard** — Richard turns the design into phases + tasks and presents the plan for your approval.
4. **The Bullpen** — an autonomous build→test→secure loop: Dinesh builds, Big Head QAs each task
   (failures loop back), Gilfoyle does security passes. Iteration budgets keep it from spinning; when
   it genuinely gets stuck it **escalates to you** instead of guessing.
5. **The Garage** — Jared documents the build and tracks the run.

Along the way it **scaffolds a real starter app first** (Astro, React/Vite, Vue, Svelte, Next.js,
Angular, Express, .NET, and more) so the team builds *on* a working base instead of an empty folder,
and it applies an **archetype blueprint** (a marketing site, a full-stack app, a budget AI SaaS, a
personal-finance tool…) that seeds the right decisions, security rules, and acceptance criteria.

**Markdown is the source of truth.** The plan, task files, and review notes are real, human-readable
files in your project folder — version-controlled, resumable, and yours. The app owns everything
privileged (filesystem, subprocesses, terminals) behind a hardened bridge; the assigned CLIs run as
autonomous teammates (auto-approve on) inside the workspace folder you picked.

> ## Parody / Fan-Tribute Notice
>
> Nucleus-AI is an **unofficial, non-commercial parody and affectionate fan tribute**. It is
> **not** affiliated with, endorsed by, or sponsored by Warner Bros. Discovery, HBO, or the
> creators of the television series *Silicon Valley*. By default the app ships an **original cast**
> ("Pete Monahan Representing") with original avatars and original, legally-distinct names
> (Richard Henderstack, Gilfoyle Zerotrust, Hoolisoft, Pipeline Labs, …) — no show likenesses are
> shown. The show-accurate names are available only as a runtime fan's wink, hidden behind a
> Silicon-Valley-trivia **easter-egg hunt**; any character, company, and product names referenced
> that way are the property of their respective owners, used purely as parody and homage — no
> infringement is intended, and no challenge to any trademark or copyright is implied. This project
> exists solely to keep the spirit of the show alive.

## Stack

- Electron + Electron Forge 8 (`@electron-forge/plugin-vite`) for packaging
- React 18 + TypeScript + Vite 8 in the renderer
- Typed IPC over a closed `contextBridge` surface (`window.nucleus`) — no generic escape hatch
- Sandboxed renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Electron Fuses hardening (no `RunAsNode`, no `NODE_OPTIONS`, ASAR integrity on)
- Zustand for renderer state (a single small store, sliced by domain)
- `node-pty` (Windows ConPTY) for CLIs that only emit to a real terminal (e.g. Antigravity)
- Vitest for the pure/decision logic and the security boundaries

## Run it

```sh
# Requires Node.js >= 22.12.0 (Electron Forge 8 refuses older Node). An .nvmrc pins it:
#   nvm install 22 && nvm use
npm install         # after PULLING on another machine, use `npm install`, NOT `npm ci`
                    # (ci wipes node_modules incl. the compiled Windows conpty.node)
npm run rebuild:pty # one-time after install: builds node-pty for Electron's ABI
                    # (scripts/rebuild-pty.mjs). macOS/Linux use electron-rebuild.
                    # WINDOWS needs VISUAL STUDIO 2022 (v17) Build Tools — the "Desktop
                    # development with C++" workload incl. a Windows SDK — plus Python.
                    # node-pty has no win32 prebuild for the Electron 41 ABI (v145), so it
                    # compiles from source inside the VS 2022 dev environment (vcvars).
                    # NOTE: VS 2026 (v18) does NOT work — node-gyp can't use it yet, so VS
                    # 2022 must be installed even if you have 2026. Without a working
                    # toolchain the PTY-only paths (Antigravity `agy`, role terminals) fail.
npm start           # dev app with HMR
npm run typecheck   # strict TS across main, preload, renderer, shared
npm test            # vitest (decision logic, parsers, path guard, sanitizers)
npm run package     # packaged build (Forge injects + verifies node-pty)
npm run make        # platform installers (Windows Squirrel · Linux .deb · macOS .dmg/.zip)
```

On Windows, `npm run make` fails fast with a clear message if `conpty.node` is missing or built for a
different Electron ABI — run `rebuild:pty` first.

## Architecture

```
src/
  main/        Electron main process — owns ALL subprocess / PTY / filesystem work
    ipc/         one registration module per IPC domain; every input validated (renderer is untrusted)
    services/    stores + engines: settings, project registry/team, CLI validate + invoke
                 (spawn or PTY), markdown workspace, room / whiteboard / bullpen engines,
                 git tracker, stack manager, verification gates, telemetry
  preload/     the only bridge — exposes the typed NucleusApi, nothing else
  renderer/    React app; never touches Node APIs
    pages/       Hacker Hostel (home), The Pitch, Investor Pitch, The Whiteboard, The Bullpen,
                 The Punch List, The Vault, The Garage, Run History, The Ledger, Terminals,
                 Projects, Default Team, AI CLIs, Templates, Rip it and Ship It, About
    state/       zustand store, sliced by domain (nav, settings, projects, conversations,
                 whiteboard, bullpen)
  shared/      domain contracts used by all three layers (roles · personas · cli · naming ·
               ipc · project · templates · blueprints · scaffold · taskfile · prompts ·
               bullpenPlan · decisions · secrets · verificationGates · easterEggs · …)
```

Key design decisions:

- **Markdown is the source of truth** for planning/execution (`docs/`, `planning/`, `tasks/`,
  `reviews/`, `handoffs/` in each workspace). The `.nucleus/` JSON layer holds app metadata only.
- **One shared invoker** (`cliInvoker`) runs every assigned CLI the same way — resolving the
  command, honoring per-CLI delivery (stdin vs argv), autopilot flags, thinking levels, and a PTY
  path for terminal-only CLIs — so the engines never special-case a tool.
- **The workspace is a boundary, not a hard sandbox.** The app's *own* file access is path-guarded
  (`resolveWorkspacePath`), but the assigned CLIs run as your OS user with auto-approve on — so the
  workspace folder is not a hard sandbox over them. Every project is git-tracked so their writes are
  always revertible; pick a folder you trust.
- **Governance built in** — iteration budgets, escalation-to-human, gated security/architect
  reviews with automatic remediation tasks, an objective verification-gate layer (typecheck/build/
  test run by the harness, not self-reported), a deployment-posture model that stops false CRITICALs,
  and a names-only secrets manifest so the team handles secrets without ever seeing a value.
- **Themes** — `nucleus-night` (default), `clarity-cloud`, `series-b-fever-dream`, switched via
  `<html data-theme>`; components consume semantic CSS tokens only.

## Working with AI agents in this repo

If you open this repo in an AI coding tool, the guide is [`CLAUDE.md`](CLAUDE.md) (architecture rules
and conventions); [`AGENTS.md`](AGENTS.md) points other tools there. Both carry one rule: **disagree
freely** — push back when an approach is wrong or over-engineered, then defer and execute well.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md) — free for noncommercial use. The license covers the
original source; the *Silicon Valley* names and likenesses referenced as parody are not licensed
(see the Parody / Fan-Tribute Notice above).
