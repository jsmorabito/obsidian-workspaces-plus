import type WorkspacesPlus from "../main";
import type { WorkspaceLeaf, WorkspaceLayoutNode } from "obsidian";
import { MarkdownScrollAdapter } from "./markdownAdapter";
import { bounded, PdfScrollAdapter } from "./adapters";
import type { ScrollAdapter } from "./adapters";
import { matchTab, ScrollStateStorage } from "./state";
import type { TabState } from "./state";

interface Tab { leaf: WorkspaceLeaf; identity: Omit<TabState, "position">; adapter: ScrollAdapter }

export class ScrollPositionManager {
  private storage: ScrollStateStorage;
  private controller = new AbortController();
  private generation = 0;
  private current = "";
  private transitioning = true;
  private stopped = false;
  private capturing = false;
  private tabs = new Map<WorkspaceLeaf, Tab>();
  private pending = new Set<WorkspaceLeaf>();
  private deferred = new Map<WorkspaceLeaf, () => Promise<void>>();
  private onActiveLeaf = (leaf: WorkspaceLeaf | null) => {
    const restore = leaf && this.deferred.get(leaf);
    if (restore && this.enabled && !this.transitioning) {
      this.deferred.delete(leaf);
      void restore();
    }
  };
  private interval: number;
  private debounce: number;
  private started = false;
  private captureSequence = 0;
  private revisions = new Map<string, number>();
  private scrollListener = () => {
    window.clearTimeout(this.debounce);
    if (this.enabled && !this.transitioning) this.debounce = window.setTimeout(() => { void this.checkpoint(); }, 800);
  };
  constructor(private plugin: WorkspacesPlus) {
    // Separate file avoids races with the many existing saveData(settings) call sites.
    const path = `${plugin.manifest.dir}/scroll-positions.json`;
    this.storage = new ScrollStateStorage(
      async () => {
        try { return await plugin.app.vault.adapter.read(path); }
        catch { return plugin.app.vault.adapter.read(`${plugin.manifest.dir}/smart-scroll.json`); }
      },
      data => plugin.app.vault.adapter.write(path, data)
    );
  }
  async load(): Promise<void> { await this.storage.load(); }
  private get enabled() { return this.plugin.settings.scrollPositionRestoration && !this.stopped; }
  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;
    this.stopped = false;
    this.interval = window.setInterval(() => { void this.checkpoint(); }, 10000);
    this.plugin.registerInterval(this.interval);
    this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", this.onActiveLeaf));
    this.plugin.registerDomEvent(document, "scroll", this.scrollListener, true);
    // registerDomEvent is cleaned by Plugin; this additional guard makes disabled mode inert.
    this.plugin.register(() => this.stop());
  }
  async configure(): Promise<void> {
    this.stop();
    this.stopped = false;
    if (!this.enabled) return;
    this.controller = new AbortController();
    this.start();
    if (!this.transitioning) await this.activate(this.current || this.plugin.workspacePlugin.activeWorkspace);
  }
  private refreshTabs(): Tab[] {
    const slots = new Map<string, string>();
    const layout = this.plugin.app.workspace.getLayout() as unknown as Record<string, WorkspaceLayoutNode>;
    const visit = (node: WorkspaceLayoutNode, path: string) => {
      if (!node) return;
      if (node.type === "leaf" && node.id) slots.set(node.id, path);
      node.children?.forEach((child, i) => visit(child, `${path}/${i}`));
    };
    for (const key of ["main", "left", "right", "floating"]) visit(layout[key], key);
    const found: Tab[] = [];
    this.plugin.app.workspace.iterateAllLeaves(leaf => {
      const state = leaf.getViewState();
      let type: TabState["type"], resource: string;
      if ((state.type === "pdf" || state.type === "markdown") && typeof state.state?.file === "string") {
        type = state.type; resource = state.state.file;
      } else return;
      const id = (leaf as unknown as { id: string }).id;
      const slot = slots.get(id);
      if (!id || !slot) return; // Never collapse unidentifiable duplicate leaves.
      let tab = this.tabs.get(leaf);
      if (!tab || tab.identity.resource !== resource || tab.identity.type !== type) {
        tab?.adapter.dispose();
        tab = { leaf, identity: { id, slot, type, resource }, adapter:
          type === "pdf" ? new PdfScrollAdapter(leaf) : new MarkdownScrollAdapter(leaf) };
        this.tabs.set(leaf, tab);
      }
      tab.identity.slot = slot;
      found.push(tab);
    });
    for (const [leaf, tab] of this.tabs) {
      if (!found.includes(tab)) { tab.adapter.dispose(); this.tabs.delete(leaf); }
    }
    return found;
  }
  private async capture(name: string, shutdown = false): Promise<void> {
    if (!this.enabled || !name) return;
    const revision = ++this.captureSequence;
    this.revisions.set(name, revision);
    const tabs = this.refreshTabs();
    const results = await Promise.all(tabs.map(async tab => {
      if (this.pending.has(tab.leaf)) return matchTab(this.storage.get(name), tab.identity);
      const identity = { ...tab.identity };
      const position = await bounded(tab.adapter.capture(), 650, null);
      return position ? { ...identity, position } : matchTab(this.storage.get(name), tab.identity);
    }));
    // A later switch can proceed while this outgoing capture completes. Its explicit workspace
    // name is still correct; only a newer capture of that same workspace may supersede it.
    if ((!this.enabled && !shutdown) || this.revisions.get(name) !== revision) return;
    // Retain unmatched saved leaves: unsaved temporary layout changes must not destroy their state.
    const next = this.storage.get(name).slice();
    for (const result of results) {
      if (!result) continue;
      const previous = matchTab(next, result);
      if (previous) next.splice(next.indexOf(previous), 1);
      next.push(result);
    }
    this.storage.set(name, next);
    await bounded(this.storage.flush(), 700, undefined);
  }
  private async checkpoint(): Promise<void> {
    if (!this.enabled || this.transitioning || this.capturing) return;
    this.capturing = true;
    try { await this.capture(this.current); }
    catch { /* A view can disappear during capture; never interrupt normal workspace use. */ }
    finally { this.capturing = false; }
  }
  /** Called synchronously before activeWorkspace changes. No capture of a half-applied target. */
  beginSwitch(): Promise<void> {
    const canCapture = !this.transitioning;
    this.transitioning = true;
    this.controller.abort();
    this.controller = new AbortController();
    ++this.generation;
    const capture = canCapture && this.enabled ? this.capture(this.current) : Promise.resolve();
    this.pending.clear();
    this.deferred.clear();
    return capture.catch(() => { /* Capturing must never prevent a layout switch. */ });
  }
  async activate(name: string): Promise<void> {
    this.current = name;
    this.transitioning = false;
    if (!this.enabled || !name) return;
    const generation = this.generation;
    const signal = this.controller.signal;
    await Promise.all(this.refreshTabs().map(async tab => {
      const saved = matchTab(this.storage.get(name), tab.identity);
      if (!saved) return;
      this.pending.add(tab.leaf);
      const restore = async () => {
        try {
          if (tab.leaf.isDeferred) await tab.leaf.loadIfDeferred();
          if (signal.aborted || generation !== this.generation || !this.enabled) return;
          await tab.adapter.restore(saved.position, signal);
        } catch { /* Unsupported/changed private API: retain saved state and layout. */ }
        finally { if (generation === this.generation) this.pending.delete(tab.leaf); }
      };
      if (tab.leaf.view.containerEl.clientHeight === 0) this.deferred.set(tab.leaf, restore);
      else await restore();
    }));
  }
  rename(oldName: string, name: string): void {
    this.revisions.delete(oldName);
    this.storage.rename(oldName, name);
    if (this.current === oldName) this.current = name;
    void this.storage.flush();
  }
  remove(name: string): void { this.revisions.delete(name); this.storage.remove(name); void this.storage.flush(); }
  shutdown(): void {
    // Obsidian does not await onunload. Final capture is best effort; checkpoints bound loss.
    const capture = this.enabled && !this.transitioning ? this.capture(this.current, true) : Promise.resolve();
    this.stop();
    void capture.catch(() => {});
  }
  stop(): void {
    ++this.generation;
    this.stopped = true;
    this.started = false;
    document.removeEventListener("scroll", this.scrollListener, true);
    this.plugin.app.workspace.off("active-leaf-change", this.onActiveLeaf);
    this.controller.abort();
    window.clearInterval(this.interval); window.clearTimeout(this.debounce);
    for (const tab of this.tabs.values()) tab.adapter.dispose();
    this.tabs.clear(); this.pending.clear(); this.deferred.clear();
  }
}
