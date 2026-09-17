import type { Moment, unitOfTime } from "moment";
import {
  WorkspacePluginInstance,
  App,
  normalizePath,
  TFile,
  WorkspaceCustomSettings,
  WorkspaceLayoutNode,
  Workspaces,
} from "obsidian";
import {
  IGranularity,
  getAllDailyNotes,
  getDailyNote,
  getDateFromPath,
  getWeeklyNote,
  getAllWeeklyNotes,
  getMonthlyNote,
  getAllMonthlyNotes,
  getQuarterlyNote,
  getAllQuarterlyNotes,
  getYearlyNote,
  getAllYearlyNotes,
  createDailyNote,
  createWeeklyNote,
  createMonthlyNote,
  createQuarterlyNote,
  createYearlyNote,
  getPeriodicNoteSettings,
} from "obsidian-daily-notes-interface";
import WorkspacesPlus from "./main";

function pathJoin (parts: string[], sep = "/"): string {
  return parts.map((part, index) => {
    if (index) {
      part = part.replace(new RegExp(`^${sep}`), "");
    }
    if (index !== parts.length - 1) {
      part = part.replace(new RegExp(`${sep}$`), "");
    }
    return part;
  }).join(sep);
}

export const RIBBON_KEY = "left-ribbon";
const SIDEBAR_KEYS = ["left", "right"] as const;

// Matches the shape (if not the exact alphabet) of the ids Obsidian itself generates for split
// nodes and leaves -- these only ever need to be unique within the layout tree they're created
// in, not to match Obsidian's own id format exactly.
function generateLayoutNodeId (): string {
  return Math.random().toString(36).slice(2, 10);
}

// state/icon/title shapes lifted directly from a real vault's own workspaces.json for each core
// view, so createBlankWorkspace()'s sidebar matches what Obsidian itself actually produces rather
// than a guessed-at minimal version.
function createSidebarLeaf (type: string, state: Record<string, unknown>, icon: string, title: string): WorkspaceLayoutNode {
  return { id: generateLayoutNodeId(), type: "leaf", state: { type, state, icon, title } };
}

export default class Utils {
  SETTINGS_ATTR = "workspaces-plus:settings-v1";
  workspacePlugin: WorkspacePluginInstance;
  app: App;
  plugin: WorkspacesPlus;

  constructor (plugin: WorkspacesPlus) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.workspacePlugin = this.app.internalPlugins.getPluginById("workspaces").instance as WorkspacePluginInstance;
  }

  getWorkspace (name: string) {
    return this.workspacePlugin.workspaces[name];
  }

  getWorkspaceSettings (name: string): WorkspaceCustomSettings | null {
    const workspace = this.getWorkspace(name);
    if (!workspace) return null;
    return (
      workspace[this.SETTINGS_ATTR] ? workspace[this.SETTINGS_ATTR] : (workspace[this.SETTINGS_ATTR] = {})
    ) as WorkspaceCustomSettings;
  }

  get activeModeName () {
    const settings = this.activeWorkspaceSettings();
    return settings?.mode;
  }

  saveActiveMode (): void {
    this.activeModeName && this.workspacePlugin.saveWorkspace(this.activeModeName);
  }

  saveActiveWorkspace () {
    this.activeWorkspace && this.workspacePlugin.saveWorkspace(this.activeWorkspace);
  }

  getActiveModeDisplayName () {
    return this.activeModeName ? this.activeModeName.replace(/^mode: /i, "") : "Global";
  }

  setWorkspaceSettings (name: string, settings: WorkspaceCustomSettings): WorkspaceCustomSettings {
    const workspace = this.getWorkspace(name);
    workspace[this.SETTINGS_ATTR] = settings;
    return workspace[this.SETTINGS_ATTR] as WorkspaceCustomSettings;
  }

  // Used by the settings tab's own rename control (see buildWorkspaceRenameSetting in
  // settings.ts) -- the quick switcher's inline rename (workspaceModal.ts's handleRename) has its
  // own separate, unit-tested implementation and isn't routed through this. Triggering
  // "workspace-rename" here reuses the same event main.ts already listens for to reassign
  // hotkeys/commands and persist the change, so both rename paths stay consistent.
  renameWorkspace (oldName: string, newName: string): { success: boolean; reason?: string } {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return { success: false };
    if (this.workspacePlugin.workspaces[trimmed]) {
      return { success: false, reason: `A workspace named "${trimmed}" already exists.` };
    }
    this.workspacePlugin.workspaces[trimmed] = this.workspacePlugin.workspaces[oldName];
    delete this.workspacePlugin.workspaces[oldName];
    if (this.activeWorkspace === oldName) this.workspacePlugin.setActiveWorkspace(trimmed);
    this.app.workspace.trigger("workspace-rename", trimmed, oldName);
    return { success: true };
  }

  // Used by the "+" button on the settings tab's "Per workspace" heading. Obsidian's own
  // saveWorkspace() always snapshots whatever layout is *currently on screen* -- there's no
  // native "blank workspace" concept -- so a genuinely empty one has to be built by hand: an
  // "empty" main leaf (Obsidian's own view type for a pane with nothing open in it, e.g. what you
  // see after closing all tabs) plus a left sidebar with the Files/Bookmarks/Search core views,
  // matching what a fresh vault normally looks like rather than a blank slate with no navigation
  // at all. This never touches the user's actual current layout. Doesn't go through
  // saveWorkspace() (would save the current layout, not a blank one), so hotkey/command
  // registration and persistence are handled here directly instead of via the "workspace-save"
  // hook main.ts's saveWorkspace patch fires.
  // `options.name` is used as-is (validated for collisions -- the caller is expected to have
  // asked the user for it, e.g. NewWorkspaceModal); omitting it falls back to the old
  // auto-numbered "New workspace" behavior the settings tab's "+" button relies on.
  // Discriminated union (rather than a flat {success,name?,reason?}) so a caller can't destructure
  // `name` without narrowing on `success` first -- TS would otherwise let that compile even though
  // `name` only actually exists on the success branch.
  createBlankWorkspace (
    options?: { name?: string; icon?: string; iconColor?: string }
  ): { success: true; name: string } | { success: false; reason: string } {
    let name = options?.name?.trim();
    if (name) {
      if (this.workspacePlugin.workspaces[name]) {
        return { success: false, reason: `A workspace named "${name}" already exists.` };
      }
    } else {
      name = "New workspace";
      for (let suffix = 2; this.workspacePlugin.workspaces[name]; suffix++) {
        name = `New workspace ${suffix}`;
      }
    }
    const leafId = generateLayoutNodeId();
    this.workspacePlugin.workspaces[name] = {
      main: {
        id: generateLayoutNodeId(),
        type: "split",
        direction: "vertical",
        children: [
          {
            id: generateLayoutNodeId(),
            type: "tabs",
            children: [{ id: leafId, type: "leaf", state: { type: "empty", state: {} } }],
          },
        ],
      },
      left: {
        id: generateLayoutNodeId(),
        type: "split",
        direction: "horizontal",
        width: 300,
        children: [
          {
            id: generateLayoutNodeId(),
            type: "tabs",
            currentTab: 0,
            children: [
              createSidebarLeaf(
                "file-explorer",
                { sortOrder: "alphabetical", autoReveal: false, showSearch: false, searchQuery: "" },
                "lucide-folder-closed",
                "Files"
              ),
              createSidebarLeaf("bookmarks", { showSearch: false, searchQuery: "" }, "lucide-bookmark", "Bookmarks"),
              createSidebarLeaf(
                "search",
                {
                  query: "",
                  matchingCase: false,
                  explainSearch: false,
                  collapseAll: false,
                  extraContext: false,
                  sortOrder: "alphabetical",
                },
                "lucide-search",
                "Search"
              ),
            ],
          },
        ],
      },
      active: leafId,
    };
    if (options?.icon || options?.iconColor) {
      const workspaceSettings = this.getWorkspaceSettings(name);
      if (options.icon) workspaceSettings.icon = options.icon;
      if (options.iconColor) workspaceSettings.iconColor = options.iconColor;
    }
    this.workspacePlugin.saveData();
    this.plugin.registerWorkspaceHotkeys();
    return { success: true, name };
  }

  // Used by the settings tab's own "Delete this workspace" button -- the quick switcher's own
  // delete (shift+delete / trash icon, workspaceModal.ts's doDelete) has its own separate flow and
  // isn't routed through this. Deleting the active workspace doesn't itself do anything to
  // Obsidian's "which workspace is active" pointer, which would otherwise keep naming a workspace
  // that no longer exists -- switching to another remaining one avoids that.
  deleteWorkspace (name: string): void {
    const wasActive = this.activeWorkspace === name;
    this.workspacePlugin.deleteWorkspace(name);
    if (wasActive) {
      const nextName = Object.keys(this.workspacePlugin.workspaces)
        .filter(n => !this.isMode(n))
        .sort()[0];
      if (nextName) this.workspacePlugin.loadWorkspace(nextName);
    }
  }

  get activeWorkspace () {
    return this.workspacePlugin.activeWorkspace;
  }

  activeWorkspaceSettings () {
    return this.getWorkspaceSettings(this.activeWorkspace);
  }

  isMode (name: string) {
    return name.match(/^mode:/i) ? true : false;
  }

  get isNativePluginEnabled () {
    return this.workspacePlugin.plugin._loaded;
  }

  getMode (name: string) {
    if (this.isMode(name)) return this.getWorkspace(name);
  }

  loadMode (workspaceName: string, modeName: string) {
    const workspace = this.getWorkspace(workspaceName);
    const workspaceSettings = this.getWorkspaceSettings(workspaceName);
    const mode = this.getMode(modeName);
    const modeSettings = this.getModeSettings(modeName);
    // logic to allow for toggling a mode off/on
    if (workspaceSettings?.mode === modeName) {
      workspaceSettings.mode = null;
    } else {
      workspaceSettings && (workspaceSettings.mode = modeName);
    }
    // load the mode's sidebar layouts, if enabled
    if (modeSettings?.saveSidebar && workspaceSettings.mode) {
      // The mode has its own explicit, per-mode sidebar choice -- a more specific setting
      // than the global preserveSidebarLayout toggle, so it should win rather than be
      // silently overwritten by whatever sidebar happens to be on screen.
      mode && this.mergeSidebarLayout(mode, { skipSidebarPreserve: true });
      this.updateFoldState(modeSettings);
    } else {
      workspace && this.mergeSidebarLayout(workspace);
      this.updateFoldState(workspaceSettings);
    }
    this.workspacePlugin.saveData(); // call saveData on the workspace plugin to persist the workspace metadata to disk
    return true;
  }

  setChildId (split: WorkspaceLayoutNode, leafId: string, fileName: string): boolean {
    if (split.type === "leaf" && split.id === leafId) {
      split.state.state.file = fileName || null;
      return true;
    }

    if (split.type === "split" || split.type === "tabs") {
      for (const child of split.children) {
        if (this.setChildId(child, leafId, fileName)) {
          return true;
        }
      }
    }

    return false;
  }

  createPeriodicNote (granularity: IGranularity, date: Moment): Promise<TFile> {
    const createFn = {
      day: createDailyNote,
      week: createWeeklyNote,
      month: createMonthlyNote,
      quarter: createQuarterlyNote,
      year: createYearlyNote,
    };
    return createFn[granularity](date);
  }

  async getPeriodicNoteFromPath (path: string): Promise<string> {
    const periods = {
      day: { get: getDailyNote, getAll: getAllDailyNotes },
      week: { get: getWeeklyNote, getAll: getAllWeeklyNotes },
      month: { get: getMonthlyNote, getAll: getAllMonthlyNotes },
      quarter: { get: getQuarterlyNote, getAll: getAllQuarterlyNotes },
      year: { get: getYearlyNote, getAll: getAllYearlyNotes },
    };
    const result = await Promise.all(
      Object.entries(periods).map(async entry => {
        const [granularity, action] = entry;
        const date = getDateFromPath(path, granularity as IGranularity);
        if (date) {
          const settings = getPeriodicNoteSettings(granularity as IGranularity);

          const resolvedPath = normalizePath(pathJoin([settings.folder, date?.format(settings.format) + ".md"]));
          // console.log(path, date, resolvedPath, settings, granularity);
          if (path == resolvedPath) {
            let dnp = action.get(date, action.getAll());
            if (dnp === null) dnp = await this.createPeriodicNote(granularity as IGranularity, date);
            return dnp.path;
          }
        }
      })
    );
    return result.find(filePath => filePath);
  }

  async applyFileOverrides (workspaceName: string, workspace: Workspaces): Promise<void> {
    const workspaceSettings = this.getWorkspaceSettings(workspaceName);
    const fileOverrides = workspaceSettings?.fileOverrides;
    if (fileOverrides) {
      await Promise.all(
        Object.entries(fileOverrides).map(async ([leafId, fileName]: [string, string]) => {
          // Each entry is isolated so one bad override (e.g. a periodic-note template that
          // fails to resolve) can't abort the whole batch and lose overrides that would
          // otherwise have applied fine.
          try {
            let parsedFileName = this.renderTemplateString(fileName);

            await this.getPeriodicNoteFromPath(parsedFileName);
            const abstractFile = this.app.vault.getAbstractFileByPath(normalizePath(parsedFileName));
            const file = abstractFile instanceof TFile ? abstractFile : null;
            if (!file) {
              fileName = null;
            }
            const result = this.setChildId(workspace.main, leafId, file?.path);
            if (!result) {
              // clean up any overrides for panes that no longer exist
              delete fileOverrides[leafId];
            }
          } catch (e) {
            console.error(`failed to apply file override for leaf ${leafId}:`, e);
          }
        })
      );
    }
  }

  captureOpenFiles(workspace: Workspaces): { [key: string]: string } {
    const openFiles: { [key: string]: string } = {};

    function extractFiles(split: WorkspaceLayoutNode): void {
      if (split.type === "leaf") {
        const file = split.state?.state?.file;
        if (file && split.id) {
          openFiles[split.id] = file;
        }
      } else if (split.type === "split" || split.type === "tabs") {
        split.children?.forEach(child => {
          extractFiles(child);
        });
      }
    }

    if (workspace?.main) {
      extractFiles(workspace.main);
    }

    return openFiles;
  }

  async restoreOpenFiles(workspaceName: string, workspace: Workspaces): Promise<void> {
    const workspaceSettings = this.getWorkspaceSettings(workspaceName);
    const trackedFiles = workspaceSettings?.trackedFiles;

    if (!trackedFiles) return;

    for (const [leafId, filePath] of Object.entries(trackedFiles)) {
      const abstractFile = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
      const file = abstractFile instanceof TFile ? abstractFile : null;
      if (file) {
        // FIle is found, set it
        if (!this.setChildId(workspace.main, leafId, file.path)) {
          // the leaf this file was tracked against no longer exists in the layout
          delete trackedFiles[leafId];
        }
      } else {
        // File not found, is not found, create a new one to keep layout intact
        this.setChildId(workspace.main, leafId, null);
      }
    }
  }

  getModeSettings (name: string) {
    if (this.isMode(name)) return this.getWorkspaceSettings(name);
  }

  updateFoldState (settings: WorkspaceCustomSettings) {
    if (settings?.explorerFoldState) this.app.saveLocalStorage("file-explorer-unfold", settings.explorerFoldState);
  }

  getDarkModeFromOS () {
    const isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return isDarkMode ? "obsidian" : "moonstone";
  }

  updateDarkModeFromOS (settings: Record<string, unknown>) {
    settings["theme"] = this.getDarkModeFromOS();
  }

  mergeSidebarLayout (newLayout: Workspaces, { skipSidebarPreserve = false }: { skipSidebarPreserve?: boolean } = {}) {
    const workspace = this.app.workspace;
    const currentLayout = workspace.getLayout();
    newLayout.main = currentLayout["main"] as WorkspaceLayoutNode;
    // Mode switches never go through preserveRibbonInLayout's other call site (main.ts's
    // loadWorkspace patch only covers plain workspace loads), so without this a mode's own
    // stored ribbon -- usually just whatever was last synced into it -- would silently replace
    // the ribbon the user currently has whenever preserveRibbon is on.
    let layoutToApply = this.plugin.settings.preserveRibbon
      ? this.preserveRibbonInLayout(newLayout, currentLayout)
      : newLayout;
    // Same rationale as the ribbon branch above: mode switches don't go through
    // preserveSidebarInLayout's other call site (main.ts's loadWorkspace patch only covers
    // plain workspace loads), so without this a mode's own stored sidebar would silently
    // replace the sidebar the user currently has whenever preserveSidebarLayout is on.
    // skipSidebarPreserve lets a caller opt a specific load out of that override -- loadMode()
    // uses it when the mode has its own explicit saveSidebar setting, since that per-mode
    // choice is more specific than the global toggle and should win rather than be silently
    // overwritten by whatever sidebar happens to be on screen.
    if (this.plugin.settings.preserveSidebarLayout && !skipSidebarPreserve) {
      layoutToApply = this.preserveSidebarInLayout(layoutToApply, currentLayout);
    }
    void workspace.changeLayout(layoutToApply);
  }

  // Returns the number of real workspaces synced, or null if there's no ribbon on the current
  // layout to sync in the first place -- callers need to tell those two "nothing happened"
  // cases apart to report an accurate message.
  syncRibbonAcrossWorkspaces (): number | null {
    const layout = this.app.workspace.getLayout();
    if (!(RIBBON_KEY in layout) || layout[RIBBON_KEY] === undefined) return null;
    const ribbonJson = JSON.stringify(layout[RIBBON_KEY]);

    let count = 0;
    for (const [name, ws] of Object.entries(this.workspacePlugin.workspaces)) {
      // Modes are keyed into this same map but aren't "workspaces" this setting is about --
      // mergeSidebarLayout() above handles ribbon preservation for mode switches on its own.
      if (this.isMode(name)) continue;
      ws[RIBBON_KEY] = JSON.parse(ribbonJson);
      count++;
    }
    return count;
  }

  preserveRibbonInLayout (targetLayout: Workspaces, ribbonSource: Record<string, unknown>): Workspaces {
    // No ribbon captured to preserve -- leave the target's own saved ribbon state alone
    // rather than stripping it, so switching still degrades to the pre-preserveRibbon behavior.
    if (!(RIBBON_KEY in ribbonSource) || ribbonSource[RIBBON_KEY] === undefined) return targetLayout;
    const result: Workspaces = Object.assign({}, targetLayout);
    result[RIBBON_KEY] = JSON.parse(JSON.stringify(ribbonSource[RIBBON_KEY]));
    return result;
  }

  // Returns the number of real workspaces synced, or null if there's no sidebar layout on the
  // current view to sync in the first place -- mirrors syncRibbonAcrossWorkspaces.
  syncSidebarAcrossWorkspaces (): number | null {
    const layout = this.app.workspace.getLayout();
    const present = SIDEBAR_KEYS.filter(key => key in layout && layout[key] !== undefined);
    if (present.length === 0) return null;
    const json: Record<string, string> = {};
    for (const key of present) json[key] = JSON.stringify(layout[key]);

    let count = 0;
    for (const [name, ws] of Object.entries(this.workspacePlugin.workspaces)) {
      // Modes are keyed into this same map but aren't "workspaces" this setting is about --
      // mergeSidebarLayout() above handles sidebar preservation for mode switches on its own.
      if (this.isMode(name)) continue;
      for (const key of present) ws[key] = JSON.parse(json[key]);
      count++;
    }
    return count;
  }

  preserveSidebarInLayout (targetLayout: Workspaces, sidebarSource: Record<string, unknown>): Workspaces {
    // No sidebar captured to preserve -- leave the target's own saved sidebar state alone
    // rather than stripping it, so switching still degrades to the pre-preserveSidebarLayout behavior.
    const present = SIDEBAR_KEYS.filter(key => key in sidebarSource && sidebarSource[key] !== undefined);
    if (present.length === 0) return targetLayout;
    const result: Workspaces = Object.assign({}, targetLayout);
    for (const key of present) result[key] = JSON.parse(JSON.stringify(sidebarSource[key]));
    return result;
  }

  // Template string rendering with math. Credit to Liam Cain https://github.com/liamcain/obsidian-daily-notes-interface
  renderTemplateString (text: string) {
    // Obsidian's core "templates" plugin instance/options aren't part of the public API,
    // so its shape is undocumented; this.app is the same global app instance the original
    // `(<any>window).app` reached for.
    const templatesInstance = this.app.internalPlugins.getPluginById("templates").instance as {
      options?: { dateFormat?: string; timeFormat?: string };
    };
    const templateOptions = templatesInstance.options;
    let dateFormat = (templateOptions && templateOptions.dateFormat) || "YYYY-MM-DD";
    let timeFormat = (templateOptions && templateOptions.timeFormat) || "HH:mm";
    const date = window.moment();
    return (text = text
      .replace(
        /{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
        (
          _match: string,
          timeOrDate: string,
          calc: string | undefined,
          timeDelta: string,
          unit: string,
          momentFormat: string
        ) => {
          const _format = timeOrDate === "time" ? timeFormat : dateFormat;
          const now = window.moment();
          const currentDate = date.clone().set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });

          if (calc) {
            currentDate.add(parseInt(timeDelta, 10), unit as unitOfTime.DurationConstructor);
          }
          const resolvedDate = momentFormat ? currentDate.format(momentFormat.substring(1).trim()) : currentDate.format(_format);
          return resolvedDate;
        }
      )
      .replace(/{{\s*yesterday\s*}}/gi, date.clone().subtract(1, "day").format(dateFormat))
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(dateFormat)));
  }
}
