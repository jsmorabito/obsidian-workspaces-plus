// Regression coverage for issue #69:
// "Clicking enter while in the rename workspace input field, without having
//  changed the workspace name, removes the workspace from the list"
//
// Root cause was in handleRename() (workspaceModal.ts / modeModal.ts): with an
// unchanged name it ran `workspaces[name] = workspaces[name]` (a no-op) and then
// `delete workspaces[name]`, wiping the workspace, after which onWorkspaceRename
// persisted the loss to disk.
//
// Neither modal file can be imported directly (they pull in `obsidian`, popper,
// ...), so we transpile them and run with a custom `require` that returns minimal
// stubs, then exercise handleRename() via Object.create(prototype) so the
// FuzzySuggestModal constructor never runs.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

// --- load a modal file with stubbed imports --------------------------------
const noop = () => {};
const stubs = {
  obsidian: { FuzzySuggestModal: class {}, Notice: class {}, Scope: class {}, setIcon: noop },
  "@popperjs/core": { createPopper: noop },
  "./settings": {},
  "./confirm": { createConfirmationDialog: noop },
  "./main": { default: class {} },
};
const fakeRequire = id => {
  if (id in stubs) return stubs[id];
  throw new Error(`unexpected require("${id}") in rename test harness`);
};
const loadModal = (file, exportName) => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)(fakeRequire, compiled, compiled.exports);
  const cls = compiled.exports[exportName];
  assert.ok(cls, `expected ${file} to export ${exportName}`);
  return cls;
};

const WorkspaceModal = loadModal("workspaceModal.ts", "WorkspacesPlusPluginWorkspaceModal");
const ModeModal = loadModal("modeModal.ts", "WorkspacesPlusPluginModeModal");

// --- test doubles ---------------------------------------------------------
const makeTargetEl = (workspaceName, typedText) => ({
  dataset: { workspaceName },
  textContent: typedText === undefined ? workspaceName : typedText,
  contentEditable: "true",
  parentElement: { parentElement: { removeClass: noop } },
});

const makeModal = (Cls, workspaces, activeWorkspace) => {
  const modal = Object.create(Cls.prototype);
  const renameEvents = [];
  modal.workspacePlugin = { workspaces };
  modal.activeWorkspace = activeWorkspace;
  modal.setWorkspace = name => renameEvents.push(`setWorkspace:${name}`);
  modal.chooser = {
    chooser: { updateSuggestions: noop },
    setSelectedItem: noop,
  };
  modal.app = {
    workspace: {
      trigger: (evt, ...args) => renameEvents.push(`${evt}:${args.join("->")}`),
    },
  };
  modal.renameEvents = renameEvents;
  return modal;
};

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

// --- workspace modal ----------------------------------------------------
console.log("workspaceModal.handleRename");

check("unchanged name is a no-op and keeps the workspace (issue #69)", () => {
  const workspaces = { Work: { id: "w" }, Home: { id: "h" } };
  const modal = makeModal(WorkspaceModal, workspaces, "Home");
  const el = makeTargetEl("Work"); // pencil-icon rename, nothing typed

  modal.handleRename(el);

  assert.deepStrictEqual(Object.keys(workspaces).sort(), ["Home", "Work"]);
  assert.deepStrictEqual(workspaces.Work, { id: "w" });
  assert.strictEqual(el.contentEditable, "false");
  assert.deepStrictEqual(modal.renameEvents, [], "no workspace-rename should be triggered");
});

check("whitespace-only name is a no-op and keeps the workspace", () => {
  const workspaces = { Work: { id: "w" } };
  const modal = makeModal(WorkspaceModal, workspaces, "Work");
  const el = makeTargetEl("Work", "   ");

  modal.handleRename(el);

  assert.deepStrictEqual(Object.keys(workspaces), ["Work"]);
  assert.strictEqual(el.textContent, "Work", "field is reverted to the original name");
  assert.strictEqual(el.contentEditable, "false");
  assert.deepStrictEqual(modal.renameEvents, []);
});

check("changed name still renames the workspace", () => {
  const workspaces = { Work: { id: "w" }, Home: { id: "h" } };
  const modal = makeModal(WorkspaceModal, workspaces, "Home");
  const el = makeTargetEl("Work", "Office");

  modal.handleRename(el);

  assert.deepStrictEqual(Object.keys(workspaces).sort(), ["Home", "Office"]);
  assert.deepStrictEqual(workspaces.Office, { id: "w" });
  assert.strictEqual(workspaces.Work, undefined);
  assert.strictEqual(el.contentEditable, "false");
  assert.deepStrictEqual(modal.renameEvents, ["workspace-rename:Office->Work"]);
});

check("changed name is trimmed before renaming", () => {
  const workspaces = { Work: { id: "w" } };
  const modal = makeModal(WorkspaceModal, workspaces, "Work");
  const el = makeTargetEl("Work", "  Office  ");

  modal.handleRename(el);

  assert.deepStrictEqual(Object.keys(workspaces), ["Office"]);
  assert.strictEqual(modal.activeWorkspace, "Office");
});

// --- mode modal -------------------------------------------------------
console.log("modeModal.handleRename");

check("unchanged mode name is a no-op and keeps the mode (issue #69)", () => {
  const workspaces = { "Mode: Focus": { id: "f" }, "Mode: Chill": { id: "c" } };
  const modal = makeModal(ModeModal, workspaces, "Mode: Chill");
  const el = makeTargetEl("Focus");

  modal.handleRename(el);

  assert.deepStrictEqual(Object.keys(workspaces).sort(), ["Mode: Chill", "Mode: Focus"]);
  assert.deepStrictEqual(workspaces["Mode: Focus"], { id: "f" });
  assert.strictEqual(el.contentEditable, "false");
  assert.deepStrictEqual(modal.renameEvents, []);
});

check("changed mode name still renames the mode", () => {
  const workspaces = {
    "Mode: Focus": { id: "f" },
    Work: { "workspaces-plus:settings-v1": { mode: "Mode: Focus" } },
  };
  const modal = makeModal(ModeModal, workspaces, "Mode: Nope");
  const el = makeTargetEl("Focus", "Deep Work");

  modal.handleRename(el);

  assert.deepStrictEqual(Object.keys(workspaces).sort(), ["Mode: Deep Work", "Work"]);
  assert.deepStrictEqual(workspaces["Mode: Deep Work"], { id: "f" });
  assert.strictEqual(workspaces["Mode: Focus"], undefined);
  assert.strictEqual(
    workspaces.Work["workspaces-plus:settings-v1"].mode,
    "Mode: Deep Work",
    "referencing workspaces are repointed at the new mode name"
  );
  assert.deepStrictEqual(modal.renameEvents, ["workspace-rename:Mode: Deep Work->Mode: Focus"]);
});

console.log(`\n${passed} checks passed`);
