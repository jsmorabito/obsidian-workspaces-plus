import type { MarkdownView, WorkspaceLeaf } from "obsidian";
import type { ScrollAdapter } from "./adapters";
import { fingerprint } from "./state";
import type { ScrollPosition } from "./state";

/** Public MarkdownSubView scroll values are source-line positions, including a fractional line. */
export class MarkdownScrollAdapter implements ScrollAdapter {
  private protected = false;
  private release: () => void = () => {};
  constructor(private leaf: WorkspaceLeaf) {}
  private view(): MarkdownView { return this.leaf.view as MarkdownView; }
  private container(): HTMLElement | null {
    const view = this.view();
    return view.containerEl.querySelector<HTMLElement>(view.getMode() === "preview" ? ".markdown-preview-view" : ".cm-scroller");
  }
  async capture(): Promise<ScrollPosition | null> {
    const view = this.view(), container = this.container();
    const scroll = view.currentMode?.getScroll();
    if (this.protected || !container?.clientHeight || !Number.isFinite(scroll) || scroll === null) return null;
    const lines = view.currentMode.get().split("\n");
    let line = Math.min(Math.floor(scroll), lines.length - 1);
    // Blank lines are ambiguous. Use a nearby nonempty source line and retain the displacement.
    for (let i = 0; i < 3 && line > 0 && !lines[line].trim(); i++) line--;
    return {
      top: container.scrollTop, left: container.scrollLeft,
      markdown: { scroll, line, hash: fingerprint(lines[line]), context: fingerprint(lines.slice(Math.max(0, line - 1), line + 2).join("\n")) },
    };
  }
  async restore(saved: ScrollPosition, signal: AbortSignal): Promise<void> {
    this.protected = true;
    const root = this.view().containerEl;
    let stopped = false, stableSince = 0, previous = NaN;
    let timer: number, timeout: number, resize: ResizeObserver;
    let finish: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer); window.clearTimeout(timeout); resize?.disconnect();
      finish();
    };
    const input = (event: Event) => {
      if (event.isTrusted) { this.protected = false; stop(); this.release(); }
    };
    const events = ["wheel", "touchstart", "pointerdown", "keydown", "input"];
    events.forEach(name => root.addEventListener(name, input, { capture: true, passive: true }));
    this.release = () => events.forEach(name => root.removeEventListener(name, input, true));
    let text: string, target = saved.markdown?.scroll;
    const resolveLine = (source: string) => {
      if (!saved.markdown) return;
      const lines = source.split("\n"), anchor = saved.markdown;
      let best = -1;
      // Hash only source lines, never persist their contents. Prefer exact context for duplicates.
      for (let i = 0; i < Math.min(lines.length, 100000); i++) {
        if (fingerprint(lines[i]) !== anchor.hash) continue;
        if (fingerprint(lines.slice(Math.max(0, i - 1), i + 2).join("\n")) === anchor.context) { best = i; break; }
        if (best < 0 || Math.abs(i - anchor.line) < Math.abs(best - anchor.line)) best = i;
      }
      target = Math.max(0, Math.min(lines.length - 0.01, best < 0 ? anchor.scroll : best + anchor.scroll - anchor.line));
    };
    const step = () => {
      if (stopped) return;
      if (signal.aborted) return stop();
      try {
        const view = this.view(), container = this.container(), mode = view.currentMode;
        if (!container?.clientHeight || !mode) return;
        const current = mode.getScroll();
        if (!Number.isFinite(current) || current === null) return; // Preview sections still rendering.
        const source = mode.get();
        if (source !== text) { text = source; resolveLine(source); stableSince = 0; }
        if (!resize) { resize = new ResizeObserver(() => { stableSince = 0; }); resize.observe(container); }
        if (target !== undefined) {
          if (Math.abs(current - target) > 0.03) { mode.applyScroll(target); stableSince = 0; }
        } else container.scrollTop = saved.top;
        container.scrollLeft = saved.left;
        const after = mode.getScroll();
        const reached = target === undefined || Math.abs(after - target) <= 0.1 ||
          (container.scrollTop >= container.scrollHeight - container.clientHeight - 2);
        if (reached && Math.abs(after - previous) < 0.03) stableSince = stableSince || Date.now();
        else stableSince = 0;
        previous = after;
        if (stableSince && Date.now() - stableSince > 1200) { this.protected = false; stop(); }
      } catch { stop(); }
    };
    signal.addEventListener("abort", stop, { once: true });
    timer = window.setInterval(step, 200); timeout = window.setTimeout(stop, 12000);
    try { step(); await done; }
    finally { window.clearInterval(timer); window.clearTimeout(timeout); resize?.disconnect(); signal.removeEventListener("abort", stop); if (!this.protected || signal.aborted) this.release(); }
  }
  dispose(): void { this.release(); }
}
