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
      mode && this.mergeSidebarLayout(mode);
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

  // Returns the leaf IDs that got a real file applied, so the caller can force-load them past
  // Obsidian's deferred-view optimization after changeLayout() -- otherwise a background leaf's
  // overridden file doesn't actually render until the user clicks that tab.
  async applyFileOverrides (workspaceName: string, workspace: Workspaces): Promise<string[]> {
    const workspaceSettings = this.getWorkspaceSettings(workspaceName);
    const fileOverrides = workspaceSettings?.fileOverrides;
    const appliedLeafIds: string[] = [];
    if (fileOverrides) {
      await Promise.all(
        Object.entries(fileOverrides).map(async ([leafId, fileName]: [string, string]) => {
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
          } else if (file) {
            appliedLeafIds.push(leafId);
          }
        })
      );
    }
    return appliedLeafIds;
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

  // Returns the leaf IDs that got a real file restored -- see the comment on applyFileOverrides.
  async restoreOpenFiles(workspaceName: string, workspace: Workspaces): Promise<string[]> {
    const workspaceSettings = this.getWorkspaceSettings(workspaceName);
    const trackedFiles = workspaceSettings?.trackedFiles;

    if (!trackedFiles) return [];

    const restoredLeafIds: string[] = [];
    for (const [leafId, filePath] of Object.entries(trackedFiles)) {
      const abstractFile = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
      const file = abstractFile instanceof TFile ? abstractFile : null;
      if (file) {
        // FIle is found, set it
        this.setChildId(workspace.main, leafId, file.path);
        restoredLeafIds.push(leafId);
      } else {
        // File not found, is not found, create a new one to keep layout intact
        this.setChildId(workspace.main, leafId, null);
      }
    }
    return restoredLeafIds;
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

  mergeSidebarLayout (newLayout: Workspaces) {
    const workspace = this.app.workspace;
    const currentLayout = workspace.getLayout();
    newLayout.main = currentLayout["main"] as WorkspaceLayoutNode;
    void workspace.changeLayout(newLayout);
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
