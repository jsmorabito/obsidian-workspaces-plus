/* Deterministic PDF, Markdown, storage, and manager fixtures exercise production code.
 * Real Obsidian compatibility still requires test-vault checks. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const cache = new Map();
function load(file, stubs = {}) {
  file = path.resolve(__dirname, "..", file);
  if (cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const req = id => id in stubs ? stubs[id] : id.startsWith(".") ? load(path.relative(path.join(__dirname, ".."), path.resolve(path.dirname(file), id + ".ts")), stubs) : require(id);
  new Function("require", "module", "exports", code)(req, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}
const { fingerprint, matchTab, ScrollStateStorage } = load("src/scrollPosition/state.ts");
const { PdfScrollAdapter } = load("src/scrollPosition/adapters.ts");
const { MarkdownScrollAdapter } = load("src/scrollPosition/markdownAdapter.ts");
const { ScrollPositionManager } = load("src/scrollPosition/manager.ts");

class Events {
  handlers = new Map();
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name, extra = {}) { for (const fn of [...(this.handlers.get(name) || [])]) fn({ target: this, isTrusted: true, ...extra }); }
  count() { return [...this.handlers.values()].reduce((n, set) => n + set.size, 0); }
}
function clock() {
  let now = 0, id = 0;
  const jobs = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) { jobs.set(++id, { fn, at: now + delay }); return id; },
    setInterval(fn, delay) { jobs.set(++id, { fn, at: now + delay, delay }); return id; },
    clearTimeout(id) { jobs.delete(id); }, clearInterval(id) { jobs.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (let safety = 0; safety < 20000; safety++) {
        const job = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
        if (!job || job[1].at > end) break;
        now = job[1].at;
        if (job[1].delay) job[1].at += job[1].delay; else jobs.delete(job[0]);
        job[1].fn();
      }
      now = end;
    },
    jobs,
  };
}
const tests = [];
const check = (name, fn) => tests.push([name, fn]);
check("workspace isolation, duplicate leaves, reconstructed IDs, and restart", async () => {
  let disk = "", writes = 0;
  const storage = new ScrollStateStorage(async () => disk, async data => { disk = data; writes++; });
  const tab = (type, id, top, page) => ({ id, slot: `main/${id}`, type, resource: type === "pdf" ? "X.pdf" : "Note.md", position: { top, left: 0, page } });
  storage.set("A", [tab("pdf", "1", 10000, 100), tab("markdown", "2", 5000), tab("markdown", "3", 8500)]);
  storage.set("B", [tab("pdf", "1", 2000, 20), tab("markdown", "2", 1000)]);
  await storage.flush(); await storage.flush(); assert.equal(writes, 1);
  const restart = new ScrollStateStorage(async () => disk, async () => {}); await restart.load();
  assert.equal(matchTab(restart.get("A"), tab("pdf", "1")).position.page, 100);
  assert.equal(matchTab(restart.get("B"), tab("pdf", "1")).position.page, 20);
  assert.equal(matchTab(restart.get("A"), tab("markdown", "2")).position.top, 5000);
  assert.equal(matchTab(restart.get("B"), tab("markdown", "2")).position.top, 1000);
  assert.equal(matchTab(restart.get("A"), tab("markdown", "3")).position.top, 8500);
  const rebuilt = tab("markdown", "new"); rebuilt.slot = "main/3";
  assert.equal(matchTab(restart.get("A"), rebuilt).position.top, 8500);
  rebuilt.slot = "unknown"; assert.equal(matchTab(restart.get("A"), rebuilt), undefined);
  restart.rename("A", "Renamed"); assert.equal(restart.get("Renamed").length, 3); assert.equal(restart.get("A").length, 0);
  assert.ok(!disk.includes("https://"));
});
check("earlier position files migrate to the new filename and current files take precedence", async () => {
  const path = "plugins/workspaces-plus/", tab = { id: "1", slot: "main/0", type: "pdf", resource: "X.pdf", position: { top: 500, left: 0, page: 2 } };
  const files = new Map([[path + "smart-scroll.json", JSON.stringify({ version: 1, workspaces: { A: [tab] } })]]);
  const plugin = { manifest: { dir: path.slice(0, -1) }, app: { vault: { adapter: {
    read: async name => { if (!files.has(name)) throw new Error("Missing file"); return files.get(name); },
    write: async (name, data) => { files.set(name, data); },
  } } } };
  const manager = new ScrollPositionManager(plugin); await manager.load();
  assert.equal(manager.storage.get("A")[0].position.page, 2);
  manager.storage.set("B", [tab]); await manager.storage.flush();
  assert.ok(files.has(path + "scroll-positions.json"));
  files.set(path + "smart-scroll.json", JSON.stringify({ version: 1, workspaces: {} }));
  const restarted = new ScrollPositionManager(plugin); await restarted.load();
  assert.equal(restarted.storage.get("B")[0].position.page, 2);
});
check("missing/corrupt/future schema and malformed entries are harmless", async () => {
  for (const disk of ["broken", '{"version":2}', '{"version":1,"workspaces":{"A":[null,{"position":{}}]}}']) {
    const storage = new ScrollStateStorage(async () => disk, async () => {}); await storage.load(); assert.deepEqual(storage.get("A"), []);
  }
});
check("PDF adapter captures page offset and restores page 100 independently of page 20", async () => {
  const time = clock(); global.window = time;
  let observers = 0;
  global.ResizeObserver = class { observe() { if (!this.active) observers++; this.active = true; } disconnect() { if (this.active) observers--; this.active = false; } };
  const root = new Events(), container = { clientHeight: 800, scrollTop: 0, scrollLeft: 0,
    getBoundingClientRect: () => ({ top: 50 }), scrollTo({ top, left }) { this.scrollTop = top; this.scrollLeft = left; } };
  const pdf = { currentPageNumber: 100, pagesCount: 200, getPageView: index => ({ div: { getBoundingClientRect: () => ({ top: 50 + index * 1000 - container.scrollTop }) } }) };
  const leaf = { view: { containerEl: root, viewer: { child: { pdfViewer: { pdfViewer: pdf, dom: { viewerContainerEl: container } } } } } };
  const adapter = new PdfScrollAdapter(leaf);
  container.scrollTop = 99250; const a = await adapter.capture(); assert.equal(a.page, 100); assert.equal(a.offset, 250);
  pdf.currentPageNumber = 20; container.scrollTop = 19180; const b = await adapter.capture(); assert.equal(b.offset, 180);
  for (const state of [a, b, a]) {
    const done = adapter.restore(state, new AbortController().signal); time.tick(1500); await done;
    assert.equal(pdf.currentPageNumber, state.page); assert.equal(container.scrollTop, (state.page - 1) * 1000 + state.offset);
    assert.equal(observers, 0); assert.equal(root.count(), 0);
  }
  const pending = adapter.restore(a, new AbortController().signal); root.emit("wheel"); container.scrollTop = 12; time.tick(15000); await pending;
  assert.equal(container.scrollTop, 12); adapter.dispose();
});

check("PDF document points survive different pane widths and independent zoom modes", async () => {
  const time = clock(); global.window = time;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  let width = 600, zoom = "page-width";
  const scale = () => zoom === "page-width" ? width / 600 : Number(zoom);
  const root = new Events();
  const container = { clientHeight: 650, clientTop: 2, clientLeft: 2,
    scrollTop: 0, scrollLeft: 0,
    get clientWidth() { return width; }, get scrollWidth() { return Math.max(width, 600 * scale() + 18); },
    get scrollHeight() { return (800 * scale() + 18) * 200; },
    getBoundingClientRect: () => ({ top: 50, left: 30 }),
    scrollTo({ top, left }) { this.scrollTop = top; this.scrollLeft = left; },
  };
  const origin = index => index * (800 * scale() + 18);
  const pdf = { currentPageNumber: 100, pagesCount: 200,
    get currentScaleValue() { return zoom; }, set currentScaleValue(value) { zoom = value; },
    getPageView: index => ({
      div: { clientTop: 9, clientLeft: 9, dataset: { loaded: "true" },
        getBoundingClientRect: () => ({ top: 52 + origin(index) - container.scrollTop,
          bottom: 52 + origin(index + 1) - container.scrollTop,
          left: 32 - container.scrollLeft, width: 600 * scale() + 18, height: 800 * scale() + 18 }),
      },
      viewport: { convertToPdfPoint: (x,y) => [x / scale(), 800 - y / scale()],
        convertToViewportPoint: (x,y) => [x * scale(), (800 - y) * scale()] },
    }),
  };
  const leaf = { view: { containerEl: root, viewer: { child: { pdfViewer: { pdfViewer: pdf, dom: { viewerContainerEl: container } } } } } };
  const adapter = new PdfScrollAdapter(leaf);
  container.scrollTop = origin(99) + 9 + 250;
  const a = await adapter.capture(); assert.deepEqual(a.pdfPoint, { x: 0, y: 550 }); assert.equal(a.pdfScale, "page-width");
  width = 1200; zoom = 2.5; pdf.currentPageNumber = 20;
  container.scrollTop = origin(19) + 9 + 180 * scale(); container.scrollLeft = 9 + 60 * scale();
  const b = await adapter.capture(); assert.deepEqual(b.pdfPoint, { x: 60, y: 620 }); assert.equal(b.pdfScale, 2.5);
  // Returning to A with a resized pane still preserves PDF point y=550. This is
  // a PDF coordinate transformation, never a percentage of the document height.
  width = 900;
  let done = adapter.restore(a, new AbortController().signal); time.tick(1500); await done;
  assert.equal(zoom, "page-width"); assert.equal(pdf.currentPageNumber, 100);
  assert.equal(container.scrollTop, origin(99) + 9 + 250 * 1.5);
  assert.equal(adapter.protected, false);
  done = adapter.restore(b, new AbortController().signal); time.tick(1500); await done;
  assert.equal(zoom, 2.5); assert.equal(pdf.currentPageNumber, 20);
  assert.equal(container.scrollTop, origin(19) + 9 + 180 * 2.5); assert.equal(container.scrollLeft, 9 + 60 * 2.5);
  // Most-visible page is 21, but the top reading line still crosses page 20.
  pdf.currentPageNumber = 21;
  assert.equal((await adapter.capture()).page, 20);
  // Near the last page a tall viewport clamps the reachable scroll target and settles.
  done = adapter.restore({ ...b, page: 200, pdfPoint: { x: 0, y: 0 } }, new AbortController().signal);
  time.tick(1500); await done; assert.equal(adapter.protected, false);
  assert.equal(container.scrollTop, container.scrollHeight - container.clientHeight);
  // PDF.js can keep reporting the next page as most visible at this reading
  // position. Do not repeatedly navigate back to the saved page on every retry.
  let jumps = 0, mostVisible = 21;
  Object.defineProperty(pdf, "currentPageNumber", { get: () => mostVisible, set: value => { jumps++; mostVisible = value; } });
  const scrollTo = container.scrollTo;
  container.scrollTo = function (coordinates) { scrollTo.call(this, coordinates); mostVisible = 21; };
  done = adapter.restore(b, new AbortController().signal); time.tick(1500); await done;
  assert.equal(jumps, 1); assert.equal(adapter.protected, false);
});
check("unsupported browser views are ignored while PDF capture continues", async () => {
  global.window = { ...clock() }; global.document = new Events();
  let disk = "", leaves = [], attempts = 0;
  const guest = { executeJavaScript() { attempts++; throw new Error("WebView must be attached and dom-ready"); } };
  const browser = { id: "browser", getViewState: () => ({ type: "surfing-view", state: { url: "https://example.test" } }),
    view: { containerEl: { clientHeight: 800, querySelector: () => guest } } };
  const container = { clientHeight: 800, scrollTop: 7400, scrollLeft: 0, getBoundingClientRect: () => ({ top: 50 }) };
  const pdf = { currentPageNumber: 8, pagesCount: 200, getPageView: index => ({ div: {
    getBoundingClientRect: () => ({ top: 50 + index * 1000 - container.scrollTop }),
  } }) };
  const leaf = { id: "pdf", getViewState: () => ({ type: "pdf", state: { file: "X.pdf" } }),
    view: { containerEl: new Events(), viewer: { child: { pdfViewer: { pdfViewer: pdf, dom: { viewerContainerEl: container } } } } } };
  const plugin = { settings: { scrollPositionRestoration: true }, manifest: { dir: "plugins/workspaces-plus" },
    app: { isMobile: false, vault: { adapter: { read: async () => disk, write: async (p, text) => { disk = text; } } }, workspace: {
      on: () => ({}), off() {}, iterateAllLeaves: fn => leaves.forEach(fn),
      getLayout: () => ({ main: { type: "tabs", children: leaves.map(l => ({ type: "leaf", id: l.id })) } }),
    } }, registerEvent() {}, registerInterval() {}, register() {}, registerDomEvent() {},
  };
  const manager = new ScrollPositionManager(plugin); await manager.load();
  leaves = [browser]; await manager.activate("First"); await manager.beginSwitch();
  leaves = [leaf]; await manager.activate("Second");
  await manager.checkpoint(); assert.equal(manager.storage.get("Second")[0].position.page, 8);
  assert.equal(manager.tabs.has(browser), false); assert.equal(attempts, 0); // Browser guests are never accessed by this feature.
  container.scrollTop = 21250; pdf.currentPageNumber = 22; await manager.beginSwitch();
  assert.equal(manager.storage.get("Second")[0].position.page, 22);
  await manager.activate("First"); await manager.beginSwitch();
  assert.equal(manager.storage.get("Second")[0].position.offset, 250);
  manager.stop();
});
check("Markdown source, Live Preview, and reading modes restore line anchors after edits and resize", async () => {
  const previousNow = Date.now;
  try {
    for (const mode of ["source", "live-preview", "preview"]) {
      const time = clock(); global.window = time; Date.now = time.now;
      global.ResizeObserver = class { observe() {} disconnect() {} };
      const root = new Events(); let height = 20, loading = false, text = Array.from({ length: 120 }, (_,i) => `Private test line ${i}`).join("\n");
      const container = { clientHeight: 400, scrollLeft: 30, scrollTop: 52.25 * height,
        get scrollHeight() { return text.split("\n").length * height; } };
      root.querySelector = selector => { assert.equal(selector, mode === "preview" ? ".markdown-preview-view" : ".cm-scroller"); return container; };
      const view = { containerEl: root, getMode: () => mode === "preview" ? "preview" : "source", currentMode: {
        getScroll: () => loading ? null : container.scrollTop / height, get: () => text,
        applyScroll: line => { time.setTimeout(() => { container.scrollTop = line * height; }, 40); },
      } };
      const adapter = new MarkdownScrollAdapter({ view });
      const saved = await adapter.capture(); assert.equal(saved.markdown.scroll, 52.25);
      assert.ok(!JSON.stringify(saved).includes("Private test"));
      text = "Inserted 1\nInserted 2\nInserted 3\n" + text + "\nMore appended content";
      height = 35; container.scrollTop = 0; loading = true;
      const done = adapter.restore(saved, new AbortController().signal); time.tick(1000); assert.equal(container.scrollTop, 0);
      loading = false; time.tick(4000); await done;
      assert.equal(container.scrollTop, 55.25 * height); assert.equal(container.scrollLeft, 30);
      assert.equal(root.count(), 0); assert.equal(time.jobs.size, 0); adapter.dispose();
      let disk = "";
      const storage = new ScrollStateStorage(async () => disk, async value => { disk = value; });
      storage.set("A", [{ id: "markdown", slot: "main/0", type: "markdown", resource: "Note.md", position: saved }]); await storage.flush();
      const restarted = new ScrollStateStorage(async () => disk, async () => {}); await restarted.load();
      assert.equal(restarted.get("A")[0].position.markdown.scroll, 52.25);
    }
  } finally { Date.now = previousNow; }
});
check("Markdown user interaction and abort stop pending restoration in every mode", async () => {
  const previousNow = Date.now;
  try {
    const time = clock(); global.window = time; Date.now = time.now;
    global.ResizeObserver = class { observe() {} disconnect() {} };
    const root = new Events(), container = { clientHeight: 100, scrollTop: 500, scrollLeft: 0, scrollHeight: 10000 };
    root.querySelector = () => container;
    let loading = false;
    const view = { containerEl: root, getMode: () => "preview", currentMode: {
      getScroll: () => loading ? null : container.scrollTop / 20,
      get: () => Array.from({ length: 300 }, (_,i) => `line ${i}`).join("\n"),
      applyScroll: line => { container.scrollTop = line * 20; },
    } };
    const adapter = new MarkdownScrollAdapter({ view }), saved = await adapter.capture();
    loading = true;
    const controller = new AbortController(), done = adapter.restore(saved, controller.signal);
    time.tick(500); root.emit("wheel"); container.scrollTop = 900; loading = false; time.tick(15000); await done;
    assert.equal(container.scrollTop, 900); assert.equal(root.count(), 0); assert.equal(time.jobs.size, 0);
    const abort = new AbortController(), pending = adapter.restore(saved, abort.signal); abort.abort(); await pending;
    assert.equal(root.count(), 0); assert.equal(time.jobs.size, 0); adapter.dispose();
  } finally { Date.now = previousNow; }
});
check("manager rapid switching, capture isolation, restart, disable, and cleanup", async () => {
  global.window = { ...clock() }; global.document = new Events();
  let disk = "", currentLeaves = [], calls = 0;
  const settings = { scrollPositionRestoration: true };
  const workspace = { activeWorkspace: "A" };
  const plugin = { settings, manifest: { dir: "plugins/workspaces-plus" }, workspacePlugin: workspace,
    app: { isMobile: false, vault: { adapter: { read: async () => disk, write: async (p, data) => { disk = data; } } }, workspace: {
      on: () => ({}), off() {},
      getLayout: () => ({ main: { type: "tabs", children: currentLeaves.map(leaf => ({ type: "leaf", id: leaf.id })) } }),
      iterateAllLeaves: fn => currentLeaves.forEach(fn),
    } }, registerEvent() {}, registerInterval() {}, register() {}, registerDomEvent(el, event, cb) { el.addEventListener(event, cb); },
  };
  const leaf = { id: "leaf", view: { containerEl: new Events() }, getViewState: () => ({ type: "pdf", state: { file: "X.pdf" } }) };
  const manager = new ScrollPositionManager(plugin); await manager.load(); manager.start();
  currentLeaves = [leaf]; await manager.activate("A");
  const tab = manager.tabs.get(leaf); let resolveCapture;
  let hiddenRestores = 0;
  tab.adapter = { capture: async () => null, restore: async () => { hiddenRestores++; }, dispose() {} };
  manager.storage.set("A", [{ ...tab.identity, position: { page: 7, top: 6000, left: 0 } }]);
  leaf.view.containerEl.clientHeight = 0;
  await manager.activate("A"); assert.equal(hiddenRestores, 0);
  leaf.view.containerEl.clientHeight = 800; manager.onActiveLeaf(leaf);
  await Promise.resolve(); await Promise.resolve(); assert.equal(hiddenRestores, 1);
  tab.adapter = { capture: () => { calls++; return new Promise(r => { resolveCapture = r; }); }, restore: async () => {}, dispose() {} };
  const outgoing = manager.beginSwitch();
  await manager.beginSwitch(); // B never became a real layout: do not capture A as B.
  resolveCapture({ page: 100, top: 99000, left: 0 }); await outgoing;
  assert.equal(manager.storage.get("A")[0].position.page, 100); assert.equal(calls, 1);
  let aborted = false, restores = 0;
  tab.adapter.restore = async (pos, signal) => { restores++; await new Promise(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); })); };
  manager.storage.set("B", [{ ...tab.identity, position: { page: 20, top: 19000, left: 0 } }]);
  const restoringB = manager.activate("B");
  await manager.beginSwitch(); await restoringB; assert.equal(aborted, true); assert.equal(restores, 1);
  assert.equal(calls, 1); // Half-restored B did not overwrite page 20.
  await manager.activate("C");
  settings.scrollPositionRestoration = false; await manager.configure();
  await manager.beginSwitch(); await manager.activate("A");
  assert.equal(calls, 1); assert.equal(restores, 1); assert.equal(global.document.count(), 0); assert.equal(global.window.jobs.size, 0);
  const restarted = new ScrollStateStorage(async () => disk, async () => {}); await restarted.load(); assert.equal(restarted.get("A")[0].position.page, 100);
});
const watchdog = setTimeout(() => { throw new Error("Scroll position tests stalled on an unresolved restoration"); }, 15000);
(async () => {
  for (const [name, fn] of tests) { await fn(); console.log(`  ok  ${name}`); }
  console.log(`\n${tests.length} scroll position checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
