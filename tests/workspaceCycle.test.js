const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/workspaceCycle.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES6 },
}).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", output)(require, compiled, compiled.exports);
const { cycleWorkspace } = compiled.exports;

const calls = [];
const load = name => calls.push(`load:${name}`);
const save = name => calls.push(`save:${name}`);

cycleWorkspace(["Work", "mode: Focus", "Home"], "Home", load);
assert.deepStrictEqual(calls.splice(0), ["load:Work"]);

cycleWorkspace(["Work", "Home"], "Work", load);
assert.deepStrictEqual(calls.splice(0), ["load:Home"]);

cycleWorkspace(["Work", "Home"], "Home", load, save);
assert.deepStrictEqual(calls.splice(0), ["save:Home", "load:Work"]);

cycleWorkspace(["Home"], "Home", load, save);
assert.deepStrictEqual(calls.splice(0), ["save:Home"]);

cycleWorkspace([], "", load, save);
assert.deepStrictEqual(calls, []);
