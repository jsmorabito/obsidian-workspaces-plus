// Regression coverage for saves racing asynchronous workspace and mode restores.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function check() {
    const timers = [], changes = [], saves = [], errors = [];
    const noop = () => {};
    const obsidian = {
        Plugin: class { register() {} },
        debounce: fn => {
            const call = (...args) => { call.pending = () => fn(...args); };
            call.cancel = () => { call.pending = null; };
            return call;
        },
    };
    // Match the other regression tests: transpile actual source with minimal Obsidian stubs.
    const load = (file, imports) => {
        const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
        const output = ts.transpileModule(source, {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        const compiled = {exports: {}};
        const fakeRequire = id => {
            if (id in imports) return imports[id];
            throw new Error(`unexpected require("${id}") in workspaceAutosave test harness`);
        };
        new Function('require', 'module', 'exports', 'window', 'console', output)(
            fakeRequire, compiled, compiled.exports,
            {setTimeout: fn => timers.push(fn)}, {error: (...args) => errors.push(args)}
        );
        return compiled.exports.default;
    };
    const Utils = load('utils.ts', {obsidian, 'obsidian-daily-notes-interface': {}});
    const WorkspacesPlus = load('main.ts', {
        obsidian,
        './settings': {DEFAULT_SETTINGS: {}, WorkspacesPlusSettingsTab: class {}},
        './workspaceModal': {WorkspacesPlusPluginWorkspaceModal: class {}},
        './modeModal': {WorkspacesPlusPluginModeModal: class {}},
        './newWorkspaceModal': {NewWorkspaceModal: class {}},
        './workspaceMenu': {openWorkspaceMenu: noop},
        './utils': {default: Utils},
        'monkey-around': require('monkey-around'),
        './workspaceCycle': {cycleWorkspace: noop},
    });
    const home = {main: {name: 'Home'}}, design = {main: {name: 'Design'}};
    let visible = home;
    const leafReady = deferred();
    const core = {
        activeWorkspace: 'Home', workspaces: {Home: home, Design: design}, plugin: {_loaded: true},
        saveWorkspace(name) { saves.push({name, layout: visible.main.name}); },
        deleteWorkspace() {}, loadWorkspace() {}, saveData() {},
    };
    const p = new WorkspacesPlus();
    p.app = core.app = {
        internalPlugins: {getPluginById: () => ({instance: core})},
        workspace: {
            trigger() {}, getLayout: () => visible,
            changeLayout: layout => {
                const pending = deferred();
                changes.push(pending);
                return pending.promise.then(() => { visible = layout; });
            },
            iterateAllLeaves: fn => fn({isDeferred: true, loadIfDeferred: () => leafReady.promise}),
        },
    };
    p.settings = {saveOnChange: true};
    p.utils = new Utils(p);
    p.workspacePlugin = core;
    p.isNativePluginEnabled = true;
    p.installWorkspaceHooks();
    const tick = () => new Promise(resolve => setImmediate(resolve));

    p.onLayoutChange();
    const staleSave = p.debouncedSave.pending;
    const first = core.loadWorkspace('Design');
    assert.equal(p.debouncedSave.pending, null, 'switch must cancel queued autosave');
    staleSave();
    core.saveWorkspace('Design');
    assert.equal(saves.length, 0, 'queued and explicit saves must be blocked during restore');
    await tick();
    timers.splice(0).forEach(fn => fn());
    assert.equal(p.workspaceLoading, true, 'a timeout must not unlock an unfinished restore');

    const second = core.loadWorkspace('Home');
    await tick();
    changes[0].resolve();
    await first;
    assert.equal(p.workspaceLoading, true, 'older restore must not unlock a newer switch');
    changes[1].resolve();
    await tick();
    assert.equal(p.workspaceLoading, true, 'wait for deferred leaves too');
    leafReady.resolve();
    await second;
    assert.equal(p.workspaceLoading, false);
    p.debouncedSave.pending();
    assert.deepEqual(saves, [{name: 'Home', layout: 'Home'}]);

    const failed = core.loadWorkspace('Design');
    await tick();
    changes[2].reject(new Error('layout failed'));
    await failed;
    assert.equal(p.workspaceLoading, true, 'failed restore must not save the old visible layout');
    core.saveWorkspace('Design');
    assert.equal(saves.length, 1);
    assert.equal(errors.length, 1);

    const retry = core.loadWorkspace('Home');
    await tick(); changes[3].resolve(); await retry;
    assert.equal(p.workspaceLoading, false, 'successful retry must unblock saves');

    p.settings.workspaceSettings = true;
    core.workspaces['Mode: Focus'] = {'workspaces-plus:settings-v1': {saveSidebar: true}};
    const mode = core.loadWorkspace('Mode: Focus');
    await tick();
    assert.equal(p.workspaceLoading, true, 'mode switches must await their sidebar layout');
    changes[4].resolve(); await mode;
    assert.equal(p.workspaceLoading, false);
    p.debouncedSave.pending();
    assert.deepEqual(saves.at(-1), {name: 'Home', layout: 'Home'});
    console.log('PASS: queued/explicit saves, slow/overlapping restores, deferred leaves, failure/retry, modes');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
