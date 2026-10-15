/** Only coordinates, source-line fingerprints, and vault-relative file paths reach disk. */
export interface ScrollPosition {
  top: number;
  left: number;
  offset?: number;
  page?: number;
  pdfPoint?: { x: number; y: number };
  pdfScale?: string | number;
  markdown?: { scroll: number; line: number; hash: string; context: string };
}
export interface TabState {
  id: string;
  slot: string;
  type: "pdf" | "markdown";
  resource: string;
  position: ScrollPosition;
}
export interface ScrollData { version: 1; workspaces: Record<string, TabState[]> }

// Opaque source-line fingerprint; never persist note text.
// Two independent 32-bit accumulators reduce accidental collisions. Not a security primitive.
export function fingerprint(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return (a >>> 0).toString(16) + ":" + (b >>> 0).toString(16);
}

export function matchTab(states: TabState[], tab: Omit<TabState, "position">): TabState | undefined {
  const candidates = states.filter(s => s.type === tab.type && s.resource === tab.resource);
  // Persisted layout leaf IDs, not newly allocated IDs: path fallback only if no ID matches.
  return candidates.find(s => s.id === tab.id) ?? candidates.find(s => s.slot === tab.slot);
}

function isPosition(value: unknown): value is ScrollPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as ScrollPosition;
  return Number.isFinite(p.top) && Number.isFinite(p.left) &&
    (p.offset === undefined || Number.isFinite(p.offset)) &&
    (p.markdown === undefined || (p.markdown && Number.isFinite(p.markdown.scroll) && p.markdown.scroll >= 0 &&
      Number.isInteger(p.markdown.line) && p.markdown.line >= 0 && typeof p.markdown.hash === "string" && typeof p.markdown.context === "string")) &&
    (p.page === undefined || (Number.isInteger(p.page) && p.page > 0)) &&
    (p.pdfPoint === undefined || (p.pdfPoint && Number.isFinite(p.pdfPoint.x) && Number.isFinite(p.pdfPoint.y))) &&
    (p.pdfScale === undefined || (typeof p.pdfScale === "number" && Number.isFinite(p.pdfScale) && p.pdfScale > 0) ||
      (typeof p.pdfScale === "string" && (/^(auto|page-width|page-height|page-fit)$/.test(p.pdfScale) ||
        (/^\d+(\.\d+)?$/.test(p.pdfScale) && Number(p.pdfScale) > 0))));
}

export class ScrollStateStorage {
  data: ScrollData = { version: 1, workspaces: Object.create(null) as Record<string, TabState[]> };
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();
  constructor(private read: () => Promise<string>, private write: (data: string) => Promise<void>) {}
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await this.read()) as ScrollData;
      if (raw?.version !== 1 || !raw.workspaces || typeof raw.workspaces !== "object") return;
      for (const [name, tabs] of Object.entries(raw.workspaces)) {
        if (!Array.isArray(tabs)) continue;
        this.data.workspaces[name] = tabs.filter(t => t && typeof t.id === "string" &&
          typeof t.slot === "string" && typeof t.resource === "string" &&
          (t.type === "pdf" || t.type === "markdown") && isPosition(t.position));
      }
    } catch { /* Missing/corrupt state must never affect layouts or settings. */ }
  }
  get(name: string): TabState[] { return this.data.workspaces[name] ?? []; }
  set(name: string, tabs: TabState[]): void {
    if (JSON.stringify(this.get(name)) === JSON.stringify(tabs)) return;
    this.data.workspaces[name] = tabs;
    this.dirty = true;
  }
  rename(oldName: string, name: string): void {
    if (Object.hasOwnProperty.call(this.data.workspaces, oldName)) {
      this.set(name, this.get(oldName));
      this.remove(oldName);
    }
  }
  remove(name: string): void { delete this.data.workspaces[name]; this.dirty = true; }
  flush(): Promise<void> {
    this.writing = this.writing.catch(() => { /* Retry on the next checkpoint. */ }).then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try { await this.write(JSON.stringify(this.data)); }
      catch { this.dirty = true; }
    });
    return this.writing;
  }
}
