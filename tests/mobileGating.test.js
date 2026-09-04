// Regression coverage for the mobile-support changes on `feat/mobile-support`.
//
// main.ts can't be imported directly (it pulls in `obsidian`, popper, moment, ...),
// so we transpile it and run it with a custom `require` that returns minimal stubs.
// We exercise pure decision logic via Object.create(prototype), so the Plugin
// constructor and the debounce()-based field initializers never run:
//   - `modesEnabled` getter: desktop parity, forced off on mobile
//   - `loadSettings()`: identical on both platforms, no per-platform mutation

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

// --- real DEFAULT_SETTINGS (kept in sync with src/settings.ts) ---------------
const DEFAULT_SETTINGS = {
  showInstructions: true,
  showDeletePrompt: true,
  saveOnSwitch: false,
  saveOnChange: false,
  workspaceSettings: false,
  systemDarkMode: false,
  globalSettings: {},
  activeWorkspaceDesktop: "",
  activeWorkspaceMobile: "",
  reloadLivePreview: false,
  workspaceSwitcherRibbon: false,
  modeSwitcherRibbon: false,
  replaceNativeRibbon: false,
  trackOpenFiles: true,
  preserveRibbon: false,
  restoreLayoutOnStartup: false,
};

// --- load main.ts with stubbed imports -------------------------------------
const source = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const noop = () => {};
const stubs = {
  obsidian: { Plugin: class {}, setIcon: noop, Notice: class {}, debounce: fn => fn },
  "./settings": { DEFAULT_SETTINGS, WorkspacesPlusSettingsTab: class {} },
  "./workspaceModal": { WorkspacesPlusPluginWorkspaceModal: class {} },
  "./modeModal": { WorkspacesPlusPluginModeModal: class {} },
  "./utils": { default: class {} },
  "monkey-around": { around: () => noop },
  "./workspaceCycle": { cycleWorkspace: noop },
};
const fakeRequire = id => {
  if (id in stubs) return stubs[id];
  throw new Error(`unexpected require("${id}") in main.ts test harness`);
};
const compiled = { exports: {} };
new Function("require", "module", "exports", output)(fakeRequire, compiled, compiled.exports);
const WorkspacesPlus = compiled.exports.default;
assert.ok(WorkspacesPlus, "expected main.ts to default-export the plugin class");

const make = () => Object.create(WorkspacesPlus.prototype);

let passed = 0;
const check = async (label, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${label}`);
};

const loadWith = async (isMobile, savedData) => {
  const p = make();
  p.app = { isMobile };
  p.loadData = async () => savedData;
  await p.loadSettings();
  return p.settings;
};

(async () => {
  // --- modesEnabled: desktop parity + mobile gating ---------------------
  console.log("modesEnabled");

  await check("desktop + modes on  -> true (parity with settings.workspaceSettings)", () => {
    const p = make();
    p.app = { isMobile: false };
    p.settings = { workspaceSettings: true };
    assert.strictEqual(p.modesEnabled, true);
  });

  await check("desktop + modes off -> false", () => {
    const p = make();
    p.app = { isMobile: false };
    p.settings = { workspaceSettings: false };
    assert.strictEqual(p.modesEnabled, false);
  });

  await check("mobile + modes on   -> false (feature gated off on mobile)", () => {
    const p = make();
    p.app = { isMobile: true };
    p.settings = { workspaceSettings: true };
    assert.strictEqual(p.modesEnabled, false);
  });

  await check("mobile + modes off  -> false", () => {
    const p = make();
    p.app = { isMobile: true };
    p.settings = { workspaceSettings: false };
    assert.strictEqual(p.modesEnabled, false);
  });

  // --- loadSettings: identical on both platforms, no per-platform mutation ---
  console.log("loadSettings");

  for (const isMobile of [false, true]) {
    const plat = isMobile ? "mobile" : "desktop";

    await check(`${plat} + no saved data -> exactly DEFAULT_SETTINGS`, async () => {
      assert.deepStrictEqual(await loadWith(isMobile, null), DEFAULT_SETTINGS);
    });

    await check(`${plat} + saved overrides -> merged over defaults`, async () => {
      const s = await loadWith(isMobile, { saveOnChange: true, activeWorkspaceDesktop: "Work" });
      assert.strictEqual(s.saveOnChange, true);
      assert.strictEqual(s.activeWorkspaceDesktop, "Work");
      assert.strictEqual(s.showInstructions, true); // untouched default preserved
    });

    await check(`${plat} never forces workspaceSwitcherRibbon on`, async () => {
      assert.strictEqual((await loadWith(isMobile, null)).workspaceSwitcherRibbon, false);
      assert.strictEqual((await loadWith(isMobile, {})).workspaceSwitcherRibbon, false);
    });

    await check(`${plat} + saved ribbon value -> respected verbatim`, async () => {
      assert.strictEqual((await loadWith(isMobile, { workspaceSwitcherRibbon: true })).workspaceSwitcherRibbon, true);
      assert.strictEqual((await loadWith(isMobile, { workspaceSwitcherRibbon: false })).workspaceSwitcherRibbon, false);
    });

    await check(`${plat} + saved preserveRibbon value -> respected verbatim`, async () => {
      assert.strictEqual((await loadWith(isMobile, { preserveRibbon: true })).preserveRibbon, true);
      assert.strictEqual((await loadWith(isMobile, { preserveRibbon: false })).preserveRibbon, false);
    });
  }

  await check("loadSettings never mutates DEFAULT_SETTINGS", async () => {
    await loadWith(true, { workspaceSwitcherRibbon: true });
    assert.strictEqual(DEFAULT_SETTINGS.workspaceSwitcherRibbon, false);
  });

  console.log(`\n${passed} checks passed`);
})().catch(err => {
  console.error(`\nFAILED after ${passed} checks:`);
  console.error(err);
  process.exit(1);
});
