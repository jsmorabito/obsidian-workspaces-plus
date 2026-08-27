# Obsidian community plugin — Workspaces Plus

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, `styles.css`.
- `isDesktopOnly: false` in `manifest.json` (and `manifest-beta.json`) — the plugin runs on mobile. Do **not** introduce Node/Electron-only APIs; guard any desktop-only behavior behind `this.app.isMobile`. Keep the flag in sync across both manifests.

## Environment & tooling

- Package manager: npm (`package-lock.json` is present but gitignored — regenerate locally with `npm install`).
- Bundler: **Rollup** (`rollup.config.js`), not esbuild. Output is CommonJS (`format: 'cjs'`), bundled to `./main.js` at the repo root with an inline (dev) or hidden (prod) sourcemap.
- Types: `obsidian` type definitions (currently pinned old — `^1.1.1` in `devDependencies`; consider bumping since `eslint-plugin-obsidianmd` targets `1.8.7`-era APIs).

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Test

```bash
npm test
```

Runs `tests/workspaceCycle.test.js` directly with `node` (no test framework/runner — plain assertions).

## Linting

- ESLint is configured via `eslint.config.mjs` using `eslint-plugin-obsidianmd` (Obsidian-specific rules: deprecated/unsupported API usage, DOM/style anti-patterns, settings-tab conventions, sentence-case UI copy) layered on `typescript-eslint`'s type-aware rules.
- Run `npm run lint` to lint the project.
- No CI lint job exists yet — consider adding a GitHub Action (see `.github/`) so lint runs on every push/PR.
- Type-aware rules (`no-unsafe-*`) require the TS project; if you add new `.ts` files outside `src/`, make sure they're covered by `tsconfig.json`'s `include`.

## File & folder conventions

- Source lives in `src/`:
  ```
  src/
    main.ts               # Plugin entry point, lifecycle management
    settings.ts            # Settings interface, defaults, settings tab
    workspaceModal.ts       # Workspace switcher modal
    modeModal.ts            # Mode switcher modal
    workspaceCycle.ts       # Workspace cycling commands
    confirm.ts              # Confirmation dialog helper
    utils.ts                # Utility functions
    obsidian.d.ts            # Ambient type augmentations for undocumented Obsidian internals
    suggesters/fileSuggest.ts
  ```
- `main.ts` currently mixes lifecycle wiring with a large amount of feature logic (context menu patching, mode handling, workspace switching). Prefer extracting new features into their own module under `src/` rather than growing `main.ts` further — see `obsidianmd` config note below.
- **Do not commit build artifacts**: `main.js`, `main.js.map`, and `node_modules/` are gitignored — keep it that way.
- `src/obsidian.d.ts` patches in undocumented/internal Obsidian APIs (accessed via `any` casts elsewhere). Any `no-unsafe-*` / `no-explicit-any` lint findings touching these are largely inherent to relying on internal APIs — narrow the `any` where practical, but don't force a rewrite that fights the private API surface.

## Manifest rules (`manifest.json`)

- Must include: `id`, `name`, `version` (SemVer `x.y.z`), `minAppVersion`, `description`, `isDesktopOnly`. Optional: `author`, `authorUrl`, `fundingUrl`.
- Never change `id` (`workspaces-plus`) after release.
- Keep `minAppVersion` accurate — `eslint-plugin-obsidianmd`'s `no-unsupported-api` rule will flag API usage that requires a newer Obsidian version than `minAppVersion` declares (e.g. it currently flags `App.saveLocalStorage`, which needs 1.8.7 vs. the declared 1.4.10). Either bump `minAppVersion` or avoid the API.
- This repo also has `manifest-beta.json` for BRAT/beta distribution — update both when bumping `minAppVersion` for a real API dependency, and keep versions logically consistent (beta can be ahead, never behind).
- Canonical requirements: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` to:
  ```
  <Vault>/.obsidian/plugins/workspaces-plus/
  ```
- Reload Obsidian and enable the plugin in **Settings → Community plugins**.
- Automated: `npm test` covers workspace-cycling logic only; most UI/modal code is untested.

## Commands & settings

- User-facing commands are added via `this.addCommand(...)` — keep IDs stable once released.
- Settings are persisted via `this.loadData()` / `this.saveData()` (see `settings.ts`).
- `eslint-plugin-obsidianmd`'s `settings-tab/prefer-setting-definitions` rule flags settings tabs that don't implement `getSettingDefinitions()` — needed for the settings tab to show up in Obsidian's in-app settings search (1.13.0+). Worth adopting incrementally.

## Versioning & releases

- Releases are automated via `auto shipit` (`auto` + `auto-plugin-obsidian`, see `.github/`) — bump `version` in `manifest.json` per SemVer and update `versions.json` to map plugin version → minimum app version.
- Release tag must exactly match `manifest.json`'s `version`, no leading `v`.
- Attach `manifest.json`, `main.js`, `styles.css` to the GitHub release.

## Security, privacy, and compliance

Follow Obsidian's Developer Policies and Plugin Guidelines:

- Default to local/offline operation; no telemetry.
- Never execute remote code or eval fetched scripts.
- Minimize vault access to what's necessary.
- Avoid `console.log`/`console.error` left in shipped code — `eslint-plugin-obsidianmd`'s `no-console` rule (via `rule-custom-message`) flags this; use it for local debugging only, and remove or gate it before committing.
- Register all DOM/app/interval listeners through `this.register*` helpers so unload doesn't leak listeners.

## UX & copy guidelines (for UI text, commands, settings)

- Sentence case for headings, buttons, titles — `eslint-plugin-obsidianmd`'s `ui/sentence-case` rule enforces this across UI strings; it's currently the single largest lint finding in this repo and a quick, low-risk cleanup pass.
- Bold for literal UI labels; "select" for interactions; arrow notation for navigation (**Settings → Community plugins**).
- Avoid manually inserting heading elements in the settings tab (`createEl('h2', ...)` etc.) — use `Setting.setHeading()` instead; flagged by `settings-tab/no-manual-html-headings`.

## Performance

- Keep `onload` light; defer heavy work.
- Batch disk/vault access; debounce expensive handlers on file-system events.

## Coding conventions

- TypeScript; `tsconfig.json` currently does **not** set `"strict": true` — the large number of `no-unsafe-*`/`no-explicit-any` lint findings largely stems from this plus heavy reliance on undocumented internal APIs (`src/obsidian.d.ts`). Tightening `strict` mode is a bigger, separate effort — don't bundle it into unrelated feature work.
- Prefer `createDiv()`/`createEl()` over `document.createElement(...)` (`obsidianmd/prefer-create-el`).
- Prefer `instanceof TFile` / `instanceof TFolder` checks over casting (`obsidianmd/no-tfile-tfolder-cast`).
- Set styles via CSS classes (`styles.css`) rather than inline `setAttribute('style', ...)`; use `setCssProps` for dynamic values (`obsidianmd/no-static-styles-assignment`).
- Prefer `async/await` over promise chains; the linter flags unhandled/floating promises (`no-floating-promises`) — several exist in `main.ts` today and are worth cleaning up.
- Bundle everything into `main.js`; no unbundled runtime deps.

## Mobile

- `isDesktopOnly: false` — the plugin is expected to run on mobile (phone and tablet).
- No Node/Electron APIs anywhere in `src/` — keep it that way (`require`, `fs`, `path`, `os`, `child_process`, `electron`, `FileSystemAdapter`).
- Workspace Modes is desktop-only: it snapshots/restores Obsidian's core `app.json`, which is shared across platforms. Route every runtime Modes branch through the `modesEnabled` getter (`workspaceSettings && !app.isMobile`) rather than adding scattered `app.isMobile` checks — that includes the Live Preview reload path, which only runs inside a `modesEnabled` block.
- The status bar is hidden by default on mobile. The **Open workspace switcher** command is the always-available entry point; the sidebar ribbon icon is off by default (same as desktop) and can be toggled on in settings.
- Per-platform active workspace is tracked separately (`activeWorkspaceMobile` / `activeWorkspaceDesktop` in `settings.ts`, switched on `app.isMobile`).
- Row action buttons in the switcher/mode modals are hover-revealed on desktop; on mobile (no hover) they render always-visible via the `.is-mobile` body class in `styles.css`.
- Test with the desktop "Emulate mobile" developer toggle first, then on a real device via BRAT.

## Agent do/don't

**Do**

- Run `npm run lint` before committing and fix new findings you introduce; pre-existing findings can be cleaned up incrementally (see "Coding conventions" above for the highest-value categories: sentence case, `no-console`, floating promises, `createEl` usage).
- Keep command IDs stable once released.
- Use `this.register*` helpers for anything needing cleanup on unload.
- When touching an undocumented/internal API in `src/obsidian.d.ts`, check whether `no-unsupported-api` flags a `minAppVersion` mismatch and reconcile `manifest.json`/`manifest-beta.json` accordingly.

**Don't**

- Introduce network calls without a clear, documented, user-facing reason.
- Leave `console.log`/`console.error` debugging statements in committed code.
- Do a blanket `--fix` or drive-by rewrite of unrelated lint findings in a feature PR — this repo has ~500 pre-existing findings; scope cleanups separately from feature changes unless asked to do a dedicated lint pass.

## References

- Obsidian sample plugin (source of this file's structure): https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- `eslint-plugin-obsidianmd`: https://github.com/obsidianmd/eslint-plugin
