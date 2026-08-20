import { settings } from "cluster";
// import type moment from "moment";
import type { Moment } from "moment";
import { WorkspacePluginInstance, App, normalizePath, TFile } from "obsidian";
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

  getWorkspaceSettings (name: string) {
    const workspace = this.getWorkspace(name);
    if (!workspace) return null;
    return workspace[this.SETTINGS_ATTR] ? workspace[this.SETTINGS_ATTR] : (workspace[this.SETTINGS_ATTR] = {});
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

  setWorkspaceSettings (name: string, settings: any): any {
    const workspace = this.getWorkspace(name);
    workspace[this.SETTINGS_ATTR] = settings;
    return workspace[this.SETTINGS_ATTR];
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

  setChildId (split: any, leafId: string, fileName: string): boolean {
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

  async applyFileOverrides (workspaceName: string, workspace: any): Promise<void> {
    let workspaceSettings = this.getWorkspaceSettings(workspaceName);
    if (workspaceSettings?.fileOverrides) {
      await Promise.all(
        Object.entries(workspaceSettings.fileOverrides).map(async ([leafId, fileName]: [string, string]) => {
          let parsedFileName = this.renderTemplateString(fileName);

          await this.getPeriodicNoteFromPath(parsedFileName);
          const file = this.app.vault.getAbstractFileByPath(normalizePath(parsedFileName)) as TFile;
          if (!file) {
            fileName = null;
          }
          const result = this.setChildId(workspace.main, leafId, file?.path);
          if (!result) {
            // clean up any overrides for panes that no longer exist
            delete workspaceSettings.fileOverrides[leafId];
          }
        })
      );
    }
  }

  captureOpenFiles(workspace: any): { [key: string]: string } {
    const openFiles: { [key: string]: string } = {};
    
    function extractFiles(split: any): void {
      if (split.type === "leaf") {
        const file = split.state?.state?.file;
        if (file && split.id) {
          openFiles[split.id] = file;
        }
      } else if (split.type === "split" || split.type === "tabs") {
        split.children?.forEach((child: any) => {
          extractFiles(child);
        });
      }
    }
    
    if (workspace?.main) {
      extractFiles(workspace.main);
    }
    
    return openFiles;
  }

  async restoreOpenFiles(workspaceName: string, workspace: any): Promise<void> {
    const workspaceSettings = this.getWorkspaceSettings(workspaceName);
    const trackedFiles = workspaceSettings?.trackedFiles;
    
    if (!trackedFiles) return;
    
    for (const [leafId, filePath] of Object.entries(trackedFiles)) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(filePath as string)) as TFile;
      if (file) {
        // FIle is found, set it
        this.setChildId(workspace.main, leafId, file.path);
      } else {
        // File not found, is not found, create a new one to keep layout intact
        this.setChildId(workspace.main, leafId, null);
      }
    }
  }

  getModeSettings (name: string) {
    if (this.isMode(name)) return this.getWorkspaceSettings(name);
  }

  updateFoldState (settings: any) {
    if (settings?.explorerFoldState) this.app.saveLocalStorage("file-explorer-unfold", settings.explorerFoldState);
  }

  getDarkModeFromOS () {
    const isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return isDarkMode ? "obsidian" : "moonstone";
  }

  updateDarkModeFromOS (settings: any) {
    settings["theme"] = this.getDarkModeFromOS();
  }

  mergeSidebarLayout (newLayout: any) {
    const workspace = this.app.workspace;
    const currentLayout = workspace.getLayout();
    newLayout["main"] = currentLayout["main"];
    void workspace.changeLayout(newLayout);
  }

  // Template string rendering with math. Credit to Liam Cain https://github.com/liamcain/obsidian-daily-notes-interface
  renderTemplateString (text: string) {
    const templateOptions = (<any>window).app.internalPlugins.getPluginById("templates").instance.options;
    let dateFormat = (templateOptions && templateOptions.dateFormat) || "YYYY-MM-DD";
    let timeFormat = (templateOptions && templateOptions.timeFormat) || "HH:mm";
    const date = window.moment();
    return (text = text
      .replace(
        /{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
        (_: any, timeOrDate: string, calc: any, timeDelta: string, unit: any, momentFormat: string) => {
          const _format = timeOrDate === "time" ? timeFormat : dateFormat;
          const now = window.moment();
          const currentDate = date.clone().set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });

          if (calc) {
            currentDate.add(parseInt(timeDelta, 10), unit);
          }
          const resolvedDate = momentFormat ? currentDate.format(momentFormat.substring(1).trim()) : currentDate.format(_format);
          return resolvedDate;
        }
      )
      .replace(/{{\s*yesterday\s*}}/gi, date.clone().subtract(1, "day").format(dateFormat))
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(dateFormat)));
  }
}
