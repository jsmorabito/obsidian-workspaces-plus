// Regression coverage for Utils.createBlankWorkspace(): the settings tab's "+" button relies on
// its auto-numbering behavior (never a name collision there), and the "New workspace" dialog
// (newWorkspaceModal.ts) relies on its name-collision validation and icon/iconColor pass-through.
// Neither path had any test coverage before this file.
//
// utils.ts can't be imported directly (it pulls in `obsidian`), so we transpile it and run with a
// custom `require` that stubs "obsidian" (only ever touched lazily, inside function bodies that
// this file doesn't call), "./main" (avoids pulling in the whole plugin class), and
// "obsidian-daily-notes-interface" -- unlike the other two, that one's real package eagerly
// requires "obsidian" itself at its own module-load time, which fails outside the Obsidian app;
// createBlankWorkspace() doesn't touch daily notes at all, so an empty stub is enough.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const stubs = {
  obsidian: {},
  "./main": { default: class {} },
  "obsidian-daily-notes-interface": {},
};
const fakeRequire = id => {
  if (id in stubs) return stubs[id];
  return require(id);
};
const source = fs.readFileSync(path.join(__dirname, "..", "src", "utils.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", output)(fakeRequire, compiled, compiled.exports);
const Utils = compiled.exports.default;
assert.ok(Utils, "expected utils.ts to default-export the Utils class");

const makeUtils = (workspaces = {}) => {
  const savedDataCalls = [];
  const registeredHotkeysCalls = [];
  const workspacePlugin = {
    workspaces,
    saveData: () => savedDataCalls.push(true),
  };
  const plugin = {
    app: {
      internalPlugins: {
        getPluginById: () => ({ instance: workspacePlugin }),
      },
    },
    registerWorkspaceHotkeys: () => registeredHotkeysCalls.push(true),
  };
  const utils = new Utils(plugin);
  return { utils, workspacePlugin, savedDataCalls, registeredHotkeysCalls };
};

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

console.log("Utils.createBlankWorkspace");

check('no options -> auto-generates "New workspace" and persists it', () => {
  const { utils, workspacePlugin, savedDataCalls, registeredHotkeysCalls } = makeUtils();
  const result = utils.createBlankWorkspace();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.name, "New workspace");
  assert.ok(workspacePlugin.workspaces["New workspace"], "workspace should be added to the workspaces map");
  assert.strictEqual(
    workspacePlugin.workspaces["New workspace"].main.children[0].children[0].state.type,
    "empty"
  );
  assert.strictEqual(savedDataCalls.length, 1);
  assert.strictEqual(registeredHotkeysCalls.length, 1);
});

check('auto-generated name is numbered past existing "New workspace" entries', () => {
  const { utils } = makeUtils({ "New workspace": {}, "New workspace 2": {} });
  const result = utils.createBlankWorkspace();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.name, "New workspace 3");
});

check("explicit name colliding with an existing workspace is rejected without mutating anything", () => {
  const { utils, workspacePlugin, savedDataCalls } = makeUtils({ Existing: { main: {} } });
  const before = JSON.stringify(workspacePlugin.workspaces);
  const result = utils.createBlankWorkspace({ name: "Existing" });
  assert.strictEqual(result.success, false);
  assert.match(result.reason, /Existing/);
  assert.strictEqual(JSON.stringify(workspacePlugin.workspaces), before);
  assert.strictEqual(savedDataCalls.length, 0);
});

check("explicit name, icon, and iconColor are all applied", () => {
  const { utils, workspacePlugin } = makeUtils();
  const result = utils.createBlankWorkspace({ name: "Focus", icon: "target", iconColor: "#ff0000" });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.name, "Focus");
  const settings = workspacePlugin.workspaces.Focus["workspaces-plus:settings-v1"];
  assert.strictEqual(settings.icon, "target");
  assert.strictEqual(settings.iconColor, "#ff0000");
});

check("left sidebar includes Files, Bookmarks, and Search in that order", () => {
  const { utils, workspacePlugin } = makeUtils();
  utils.createBlankWorkspace({ name: "Sidebar Check" });
  const leaves = workspacePlugin.workspaces["Sidebar Check"].left.children[0].children;
  assert.deepStrictEqual(
    leaves.map(leaf => leaf.state.type),
    ["file-explorer", "bookmarks", "search"]
  );
});

console.log(`\n${passed} checks passed`);
