// Regression coverage for auto-saving a workspace when the left ribbon order changes.
//
// Ribbon drags and hide/unhide call `app.workspace.leftRibbon.onChange(persist)` directly --
// they never fire Obsidian's "layout-change" event, which is the only thing onLayoutChange
// listens to -- so without installRibbonSaveHook() wrapping onChange, auto-save on change never
// captures a reordered or hidden ribbon icon.
//
// main.ts can't be imported directly (it pulls in `obsidian`, popper, moment, ...), so we
// transpile it and run it with a custom `require` that returns minimal stubs (same approach as
// mobileGating.test.js), except for "monkey-around": installRibbonSaveHook() relies on its real
// cooperative-removal semantics (safe unwrap no matter which plugin wraps/unwraps the ribbon's
// onChange first), so that part is left un-stubbed and required for real.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const monkeyAround = require("monkey-around");

const noop = () => {};
const stubs = {
  obsidian: { Plugin: class {}, setIcon: noop, Notice: class {}, debounce: fn => fn },
  "./settings": { DEFAULT_SETTINGS: {}, WorkspacesPlusSettingsTab: class {} },
  "./workspaceModal": { WorkspacesPlusPluginWorkspaceModal: class {} },
  "./modeModal": { WorkspacesPlusPluginModeModal: class {} },
  "./newWorkspaceModal": { NewWorkspaceModal: class {} },
  "./workspaceMenu": { openWorkspaceMenu: noop },
  "./utils": { default: class {} },
  "monkey-around": monkeyAround,
  "./workspaceCycle": { cycleWorkspace: noop },
  "./settingsDeclarative": { refreshIfDeclarative: noop },
};
const fakeRequire = id => {
  if (id in stubs) return stubs[id];
  throw new Error(`unexpected require("${id}") in ribbonAutoSave test harness`);
};

const source = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", output)(fakeRequire, compiled, compiled.exports);
const WorkspacesPlus = compiled.exports.default;
assert.ok(WorkspacesPlus, "expected main.ts to default-export the plugin class");

// Minimal stand-in for Obsidian's internal WorkspaceRibbon: just enough for onChange wrapping.
const makeRibbon = () => ({
  onChangeCalls: [],
  onChange(persist) {
    this.onChangeCalls.push(persist);
  },
});

// `new WorkspacesPlus()` (rather than Object.create(prototype)) so the real onLayoutChange /
// debouncedSave field initializers run -- they're plain closures under the stubs above (no I/O,
// nothing touches `this.settings`/`this.utils` until called), so this is safe, and it means the
// ribbon hook's delegation to `this.onLayoutChange()` is exercised for real, not reimplemented.
const make = ribbon => {
  const p = new WorkspacesPlus();
  p.app = { workspace: { leftRibbon: ribbon } };
  p.settings = { saveOnChange: true };
  p.workspaceLoading = false;
  p.utils = { activeWorkspace: "Work" };
  p.debouncedSaveCalls = [];
  p.debouncedSave = workspaceName => p.debouncedSaveCalls.push(workspaceName);
  p.registeredCleanups = [];
  p.register = cb => p.registeredCleanups.push(cb);
  return p;
};

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

console.log("installRibbonSaveHook");

check("missing leftRibbon -> no throw, nothing registered", () => {
  const p = new WorkspacesPlus();
  p.app = { workspace: {} };
  p.registeredCleanups = [];
  p.register = cb => p.registeredCleanups.push(cb);
  p.installRibbonSaveHook();
  assert.strictEqual(p.registeredCleanups.length, 0);
});

check("leftRibbon.onChange not a function -> no throw, ribbon untouched", () => {
  const ribbon = { onChange: "not a function" };
  const p = make(ribbon);
  p.installRibbonSaveHook();
  assert.strictEqual(ribbon.onChange, "not a function");
  assert.strictEqual(p.registeredCleanups.length, 0);
});

check("always calls through to the original handler with the same persist value", () => {
  const ribbon = makeRibbon();
  const p = make(ribbon);
  p.installRibbonSaveHook();

  ribbon.onChange(true);
  ribbon.onChange(false);

  assert.deepStrictEqual(ribbon.onChangeCalls, [true, false]);
});

check("persist true -> delegates to the real onLayoutChange (saves via debouncedSave)", () => {
  const ribbon = makeRibbon();
  const p = make(ribbon);
  p.installRibbonSaveHook();

  ribbon.onChange(true);

  assert.deepStrictEqual(p.debouncedSaveCalls, ["Work"]);
});

check("persist false -> never delegates to onLayoutChange (e.g. workspace-load re-render)", () => {
  const ribbon = makeRibbon();
  const p = make(ribbon);
  p.installRibbonSaveHook();

  ribbon.onChange(false);

  assert.deepStrictEqual(p.debouncedSaveCalls, []);
});

check("saveOnChange off -> onLayoutChange's own guard still blocks the save", () => {
  const ribbon = makeRibbon();
  const p = make(ribbon);
  p.settings.saveOnChange = false;
  p.installRibbonSaveHook();

  ribbon.onChange(true);

  assert.deepStrictEqual(p.debouncedSaveCalls, []);
});

check("workspaceLoading -> onLayoutChange's own guard still blocks the save", () => {
  const ribbon = makeRibbon();
  const p = make(ribbon);
  p.workspaceLoading = true;
  p.installRibbonSaveHook();

  ribbon.onChange(true);

  assert.deepStrictEqual(p.debouncedSaveCalls, []);
});

check("unload restores the original handler when ours is still installed", () => {
  const ribbon = makeRibbon();
  const original = ribbon.onChange;
  const p = make(ribbon);
  p.installRibbonSaveHook();

  assert.notStrictEqual(ribbon.onChange, original, "onChange should now be wrapped");
  p.registeredCleanups.forEach(cb => cb());

  assert.strictEqual(ribbon.onChange, original);
});

check("unload is safe even if another plugin wrapped onChange on top of ours first", () => {
  const ribbon = makeRibbon();
  const original = ribbon.onChange;
  const p = make(ribbon);
  p.installRibbonSaveHook();

  // Simulate another plugin (e.g. Commander) wrapping onChange after us, the same way Commander
  // actually does it: capture whatever onChange currently is (our wrapper) as "original", call
  // through to it, then do its own thing. This is the real chain -- unlike a stub that replaces
  // onChange outright -- so it actually exercises what happens to our wrapper on unload.
  const theirOriginal = ribbon.onChange;
  const theirCalls = [];
  const theirs = persist => {
    theirOriginal.call(ribbon, persist);
    theirCalls.push(persist);
  };
  ribbon.onChange = theirs;

  // We unload first, while their wrapper is on top of ours.
  p.registeredCleanups.forEach(cb => cb());

  // Their wrapper must still be installed and still work...
  assert.strictEqual(ribbon.onChange, theirs, "our unload must not clobber a later wrapper");
  ribbon.onChange(true);
  assert.deepStrictEqual(theirCalls, [true]);
  assert.deepStrictEqual(ribbon.onChangeCalls, [true], "the real original ribbon behavior still ran");

  // ...and our own save logic must NOT still be running as a hidden link in their chain.
  assert.deepStrictEqual(
    p.debouncedSaveCalls,
    [],
    "our wrapper must stop acting once unloaded, even though it's still referenced inside their wrapper"
  );
});

console.log("onLayoutChange");

check("saveOnChange on + not loading -> saves the active workspace", () => {
  const p = new WorkspacesPlus();
  p.settings = { saveOnChange: true };
  p.workspaceLoading = false;
  p.utils = { activeWorkspace: "Work" };
  p.debouncedSaveCalls = [];
  p.debouncedSave = workspaceName => p.debouncedSaveCalls.push(workspaceName);

  p.onLayoutChange();

  assert.deepStrictEqual(p.debouncedSaveCalls, ["Work"]);
});

check("saveOnChange off -> never saves", () => {
  const p = new WorkspacesPlus();
  p.settings = { saveOnChange: false };
  p.workspaceLoading = false;
  p.utils = { activeWorkspace: "Work" };
  p.debouncedSaveCalls = [];
  p.debouncedSave = workspaceName => p.debouncedSaveCalls.push(workspaceName);

  p.onLayoutChange();

  assert.deepStrictEqual(p.debouncedSaveCalls, []);
});

check("workspaceLoading -> never saves", () => {
  const p = new WorkspacesPlus();
  p.settings = { saveOnChange: true };
  p.workspaceLoading = true;
  p.utils = { activeWorkspace: "Work" };
  p.debouncedSaveCalls = [];
  p.debouncedSave = workspaceName => p.debouncedSaveCalls.push(workspaceName);

  p.onLayoutChange();

  assert.deepStrictEqual(p.debouncedSaveCalls, []);
});

console.log(`\n${passed} checks passed`);
