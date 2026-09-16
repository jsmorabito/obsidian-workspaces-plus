// Regression coverage for the "preserve/sync sidebar layout across workspaces" feature
// (issue #135), which mirrors the existing ribbon preserve/sync feature but for the
// left/right sidebar panes.
//
// src/utils.ts can't be imported directly (it pulls in `obsidian` and
// `obsidian-daily-notes-interface`), so we transpile it and run it with a custom
// `require` that returns minimal stubs, then exercise the pure logic via
// Object.create(prototype) so the Utils constructor never runs.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

// --- load utils.ts with stubbed imports ------------------------------------
const noop = () => {};
const stubs = {
  obsidian: { normalizePath: noop, TFile: class {} },
  "obsidian-daily-notes-interface": {
    getAllDailyNotes: noop,
    getDailyNote: noop,
    getDateFromPath: noop,
    getWeeklyNote: noop,
    getAllWeeklyNotes: noop,
    getMonthlyNote: noop,
    getAllMonthlyNotes: noop,
    getQuarterlyNote: noop,
    getAllQuarterlyNotes: noop,
    getYearlyNote: noop,
    getAllYearlyNotes: noop,
    createDailyNote: noop,
    createWeeklyNote: noop,
    createMonthlyNote: noop,
    createQuarterlyNote: noop,
    createYearlyNote: noop,
    getPeriodicNoteSettings: noop,
  },
};
const fakeRequire = id => {
  if (id in stubs) return stubs[id];
  throw new Error(`unexpected require("${id}") in sidebarSync test harness`);
};

const source = fs.readFileSync(path.join(__dirname, "../src/utils.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", output)(fakeRequire, compiled, compiled.exports);
const Utils = compiled.exports.default;
assert.ok(Utils, "expected utils.ts to default-export the Utils class");

const makeUtils = workspaces => {
  const u = Object.create(Utils.prototype);
  u.app = { workspace: { getLayout: () => u.currentLayout } };
  u.workspacePlugin = { workspaces };
  return u;
};

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

// --- syncSidebarAcrossWorkspaces -------------------------------------------
console.log("syncSidebarAcrossWorkspaces");

check("no left/right on current layout -> null, nothing touched", () => {
  const workspaces = { Work: { left: { id: "old" } } };
  const u = makeUtils(workspaces);
  u.currentLayout = { main: { id: "m" } };

  const result = u.syncSidebarAcrossWorkspaces();

  assert.strictEqual(result, null);
  assert.deepStrictEqual(workspaces.Work.left, { id: "old" });
});

check("left only present -> copies left into every non-mode workspace, leaves right untouched", () => {
  const workspaces = {
    Work: { left: { id: "old-left" }, right: { id: "old-right" } },
    Home: {},
  };
  const u = makeUtils(workspaces);
  u.currentLayout = { left: { id: "new-left", children: [] } };

  const count = u.syncSidebarAcrossWorkspaces();

  assert.strictEqual(count, 2);
  assert.deepStrictEqual(workspaces.Work.left, { id: "new-left", children: [] });
  assert.deepStrictEqual(workspaces.Work.right, { id: "old-right" });
  assert.deepStrictEqual(workspaces.Home.left, { id: "new-left", children: [] });
});

check("both left and right present -> copies both, deep-cloned (no shared references)", () => {
  const workspaces = { Work: {} };
  const u = makeUtils(workspaces);
  u.currentLayout = {
    left: { id: "L", children: [{ id: "c1" }] },
    right: { id: "R", children: [{ id: "c2" }] },
  };

  u.syncSidebarAcrossWorkspaces();

  assert.deepStrictEqual(workspaces.Work.left, u.currentLayout.left);
  assert.deepStrictEqual(workspaces.Work.right, u.currentLayout.right);
  assert.notStrictEqual(workspaces.Work.left, u.currentLayout.left, "left must be a clone, not a shared reference");
  assert.notStrictEqual(workspaces.Work.left.children, u.currentLayout.left.children);
});

check("modes are skipped, real workspaces still synced and counted", () => {
  const workspaces = {
    Work: {},
    "Mode: Focus": { left: { id: "mode-left" } },
  };
  const u = makeUtils(workspaces);
  u.currentLayout = { left: { id: "new-left" } };

  const count = u.syncSidebarAcrossWorkspaces();

  assert.strictEqual(count, 1);
  assert.deepStrictEqual(workspaces.Work.left, { id: "new-left" });
  assert.deepStrictEqual(workspaces["Mode: Focus"].left, { id: "mode-left" }, "modes are untouched by this sync");
});

check("no other workspaces besides modes -> count is 0, not null", () => {
  const workspaces = { "Mode: Focus": {} };
  const u = makeUtils(workspaces);
  u.currentLayout = { left: { id: "new-left" } };

  const count = u.syncSidebarAcrossWorkspaces();

  assert.strictEqual(count, 0);
});

// --- preserveSidebarInLayout ------------------------------------------------
console.log("preserveSidebarInLayout");

check("source has neither left nor right -> target returned unchanged (same reference)", () => {
  const u = Object.create(Utils.prototype);
  const target = { main: { id: "m" }, left: { id: "target-left" } };

  const result = u.preserveSidebarInLayout(target, { main: { id: "irrelevant" } });

  assert.strictEqual(result, target);
});

check("source has left and right -> both cloned onto a new object, target not mutated", () => {
  const u = Object.create(Utils.prototype);
  const target = { main: { id: "m" }, left: { id: "target-left" }, right: { id: "target-right" } };
  const source = { left: { id: "source-left", children: [] }, right: { id: "source-right", children: [] } };

  const result = u.preserveSidebarInLayout(target, source);

  assert.notStrictEqual(result, target, "a new object should be returned");
  assert.deepStrictEqual(result.left, source.left);
  assert.deepStrictEqual(result.right, source.right);
  assert.notStrictEqual(result.left, source.left, "left must be a clone, not a shared reference");
  assert.strictEqual(target.left.id, "target-left", "original target object must not be mutated");
  assert.strictEqual(result.main, target.main, "unrelated keys (main) pass through untouched");
});

check("source has only left -> right falls back to target's own saved right", () => {
  const u = Object.create(Utils.prototype);
  const target = { right: { id: "target-right" } };
  const source = { left: { id: "source-left" } };

  const result = u.preserveSidebarInLayout(target, source);

  assert.deepStrictEqual(result.left, { id: "source-left" });
  assert.deepStrictEqual(result.right, { id: "target-right" });
});

// --- mergeSidebarLayout (mode-switch path) ----------------------------------
console.log("mergeSidebarLayout");

const makeMergeUtils = (preserveSidebarLayout, currentLayout) => {
  const u = Object.create(Utils.prototype);
  let appliedLayout;
  u.plugin = { settings: { preserveRibbon: false, preserveSidebarLayout } };
  u.app = {
    workspace: {
      getLayout: () => currentLayout,
      changeLayout: layout => {
        appliedLayout = layout;
      },
    },
  };
  return { u, getAppliedLayout: () => appliedLayout };
};

check("preserveSidebarLayout on, no skip -> mode's own sidebar overwritten with the current one (issue #135 regression: modes without their own explicit sidebar setting should still respect the global toggle)", () => {
  const { u, getAppliedLayout } = makeMergeUtils(true, { main: { id: "cur-main" }, left: { id: "cur-left" } });
  const newLayout = { left: { id: "modes-own-left" } };

  u.mergeSidebarLayout(newLayout);

  assert.deepStrictEqual(getAppliedLayout().left, { id: "cur-left" });
});

check("preserveSidebarLayout on + skipSidebarPreserve -> mode's own explicit sidebar wins over the global toggle", () => {
  const { u, getAppliedLayout } = makeMergeUtils(true, { main: { id: "cur-main" }, left: { id: "cur-left" } });
  const newLayout = { left: { id: "modes-own-left" } };

  u.mergeSidebarLayout(newLayout, { skipSidebarPreserve: true });

  assert.deepStrictEqual(getAppliedLayout().left, { id: "modes-own-left" });
});

check("preserveSidebarLayout off -> skipSidebarPreserve is moot, mode's own sidebar is used", () => {
  const { u, getAppliedLayout } = makeMergeUtils(false, { main: { id: "cur-main" }, left: { id: "cur-left" } });
  const newLayout = { left: { id: "modes-own-left" } };

  u.mergeSidebarLayout(newLayout);

  assert.deepStrictEqual(getAppliedLayout().left, { id: "modes-own-left" });
});

console.log(`\n${passed} checks passed`);
