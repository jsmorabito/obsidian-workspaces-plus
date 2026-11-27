// Exercise the declarative UI contract: arbitrary templates must be editable and
// persisted verbatim, including workspace/leaf names that need key encoding.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/settingsDeclarative.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
let suggestedInput;
const stubs = {
  obsidian: { PluginSettingTab: class {} },
  "./suggesters/fileSuggest": { FileSuggest: class {
    constructor(app, input) { suggestedInput = input; }
  } },
  "./settings": {
    TOGGLE_TEXT: new Proxy({}, { get: () => ({}) }),
    WORKSPACE_BADGES_TEXT: {},
    WORKSPACE_RIBBON_LOCATION_TEXT: {},
    getChildIds: node => node.children,
  },
};
new Function("require", "module", "exports", output)(id => {
  assert.ok(id in stubs, `unexpected import ${id}`);
  return stubs[id];
}, compiled, compiled.exports);
const api = compiled.exports;
const workspaceName = "Journal: daily/%";
const leafId = "pane:1/%";
const settings = {};
let saves = 0;
const tab = { plugin: {
  app: { isMobile: false },
  settings: {},
  utils: {
    isNativePluginEnabled: true,
    isMode: () => false,
    getWorkspaceSettings: name => {
      assert.strictEqual(name, workspaceName);
      return settings;
    },
  },
  workspacePlugin: {
    workspaces: { [workspaceName]: { main: { children: [
      { id: leafId, file: "Original.md" }, { file: "No ID.md" },
    ] } } },
    saveData: () => { saves++; },
  },
} };
const page = api.getSettingDefinitions(tab).find(item => item.heading === "Workspaces").items[0];
const overrides = page.items.find(item => item.heading === "File overrides").items;
assert.strictEqual(overrides.length, 1);
const input = {
  inputEl: {},
  setPlaceholder(value) { this.placeholder = value; return this; },
  setValue(value) { this.value = value; return this; },
  onChange(callback) { this.change = callback; return this; },
};
const setting = {
  setClass() { return this; },
  addSearch(callback) { callback(input); return this; },
};
overrides[0].render(setting);
assert.strictEqual(suggestedInput, input.inputEl, "editable input retains file suggestions");
assert.strictEqual(input.placeholder, "Original.md");
assert.strictEqual(input.value, "");
const key = `workspace-override:${encodeURIComponent(workspaceName)}:${encodeURIComponent(leafId)}`;
for (const value of ["Journal/{{date:YYYY-MM-DD}}.md", "{{yesterday}}.md", "Existing.md"]) {
  input.change(value);
  assert.strictEqual(settings.fileOverrides[leafId], value);
  assert.strictEqual(api.getControlValue(tab, key), value);
  overrides[0].render(setting);
  assert.strictEqual(input.value, value, "saved text survives rendering");
}
input.change("");
assert.ok(!(leafId in settings.fileOverrides));
assert.strictEqual(api.getControlValue(tab, key), "");
assert.strictEqual(saves, 4);
console.log("File override tests passed");
