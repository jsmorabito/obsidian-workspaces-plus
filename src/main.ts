import {
  Plugin,
  WorkspacePluginInstance,
  setIcon,
  Notice,
  debounce,
  WorkspaceCustomSettings,
  WorkspaceLeaf,
  Workspaces,
} from "obsidian";
import { WorkspacesPlusSettings, WorkspacesPlusSettingsTab, DEFAULT_SETTINGS } from "./settings";
import { WorkspacesPlusPluginWorkspaceModal } from "./workspaceModal";
import { WorkspacesPlusPluginModeModal } from "./modeModal";
import { around } from "monkey-around";
import Utils from "./utils";
import { cycleWorkspace as runWorkspaceCycle } from "./workspaceCycle";

export default class WorkspacesPlus extends Plugin {
  settings: WorkspacesPlusSettings;
  workspacePlugin: WorkspacePluginInstance;
  debug: boolean;
  workspaceLoading: boolean;
  statusBarWorkspace: HTMLElement;
  statusBarMode: HTMLElement;
  ribbonIconMode: HTMLElement;
  ribbonIconWorkspaces: HTMLElement;
  nativeWorkspaceRibbonItem: HTMLElement;
  isNativePluginEnabled: boolean;
  utils: Utils;
  // Set when setPlatformWorkspace() triggers a workspace-load at startup (only happens when
  // settings.restoreLayoutOnStartup is on), so enableModesFeature()'s own onWorkspaceLoad()
  // bootstrap call can skip re-running it. One-shot: consumed (cleared) the first time
  // enableModesFeature() checks it, so a later, user-triggered call to enableModesFeature()
  // (e.g. toggling modes on mid-session) still does its own onWorkspaceLoad() call as before.
  private startupWorkspaceLoadTriggered = false;
  // Incremented on every non-mode loadWorkspace() invocation. Lets an in-flight restore chain
  // (restoreOpenFiles/applyFileOverrides -> changeLayout -> deferred-leaf loading -> saveData)
  // recognize it's been superseded by a newer workspace switch and bail out instead of
  // re-applying a stale layout or persisting stale data over the newer switch.
  private workspaceLoadGeneration = 0;

  async onload() {
    this.debug = false;
    // load settings
    await this.loadSettings();
    this.utils = new Utils(this);
    this.workspacePlugin = this.utils.workspacePlugin;
    this.isNativePluginEnabled = this.utils.isNativePluginEnabled;
    this.installWorkspaceHooks();
    this.registerEvent(
      this.app.internalPlugins.on("change", plugin => {
        if (plugin?.instance?.id == "workspaces") {
          if (plugin?._loaded) {
            // load
            this.isNativePluginEnabled = true;
            // this.setWorkspaceName();
          } else {
            // unload
            this.isNativePluginEnabled = false;
            // this.setWorkspaceName();
          }
        }
      })
    );

    // add the settings tab
    this.addSettingTab(new WorkspacesPlusSettingsTab(this.app, this));

    this.registerEventHandlers();
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      // store current Obsidian settings into local plugin storage -- must run before
      // setPlatformWorkspace(), which (when settings.restoreLayoutOnStartup is on) can trigger
      // a synchronous workspace-load that reads globalSettings back via mergeGlobalSettings();
      // if globalSettings were still empty at that point, applySettings() would overwrite (and
      // persist) an empty app.vault.config.
      if (this.modesEnabled) this.storeGlobalSettings();
      this.setPlatformWorkspace();

      this.backupCoreConfig();

      window.setTimeout(() => {
        this.registerWorkspaceHotkeys();
        this.setWorkspaceAttribute();
        this.addStatusBarIndicator.apply(this);
        if (this.modesEnabled) this.enableModesFeature();
        if (this.settings.workspaceSwitcherRibbon) {
          this.toggleWorkspaceRibbonButton();
          this.toggleNativeWorkspaceRibbon();
        }
        if (this.modesEnabled && this.settings.modeSwitcherRibbon) {
          this.toggleModeRibbonButton();
        }
      }, 100);
    });
  }

  backupCoreConfig() {
    void this.backupConfigFile("workspaces");
    void this.backupConfigFile("app");
    void this.backupConfigFile("appearance");
  }

  async backupConfigFile(configType: string): Promise<void> {
    const configFileName = this.manifest.dir + `/${configType}.json.bak`;
    const fileExists = await this.app.vault.exists(configFileName);
    if (!fileExists) {
      const configData = await this.app.vault.readConfigJson(configType);
      if (configData && typeof configData === "object")
        return this.app.vault.writeJson(configFileName, configData, true);
    }
  }

  onunload(): void {
    if (this.modesEnabled) {
      let combinedSettings = this.mergeGlobalSettings();
      this.applySettings(combinedSettings);
    }
    delete document.body.dataset.workspaceMode;
    delete document.body.dataset.workspaceName;
    if (this.settings.replaceNativeRibbon && this.nativeWorkspaceRibbonItem) {
      this.nativeWorkspaceRibbonItem.show();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<WorkspacesPlusSettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  registerCommands() {
    this.addCommand({
      id: "open-workspaces-plus",
      name: "Open workspace switcher",
      callback: () => new WorkspacesPlusPluginWorkspaceModal(this, this.settings, true).open(),
    });
    this.addCommand({
      id: "save-workspace",
      name: `Save current workspace`,
      callback: () => {
        this.workspacePlugin.saveWorkspace(this.workspacePlugin.activeWorkspace);
        new Notice("Successfully saved workspace: " + this.workspacePlugin.activeWorkspace);
      },
    });
    this.addCommand({
      id: "cycle-workspace",
      name: "Cycle to next workspace",
      callback: () => this.cycleWorkspace(),
    });
    this.addCommand({
      id: "save-and-cycle-workspace",
      name: "Save current workspace and cycle to next",
      callback: () => this.cycleWorkspace(true),
    });
    this.addCommand({
      id: "sync-ribbon-to-all-workspaces",
      name: "Sync current ribbon layout to all workspaces",
      callback: () => this.syncRibbonToAllWorkspaces(),
    });
  }

  syncRibbonToAllWorkspaces(): void {
    if (!this.isNativePluginEnabled) return;
    const count = this.utils.syncRibbonAcrossWorkspaces();
    if (count > 0) {
      this.workspacePlugin.saveData();
      new Notice(`Synced ribbon layout to ${count} workspaces.`);
    } else {
      new Notice("No ribbon layout detected to sync.");
    }
  }

  cycleWorkspace(saveCurrent: boolean = false): void {
    const activeWorkspace = this.workspacePlugin.activeWorkspace;
    runWorkspaceCycle(
      Object.keys(this.workspacePlugin.workspaces),
      activeWorkspace,
      workspaceName => this.workspacePlugin.loadWorkspace(workspaceName),
      saveCurrent ? workspaceName => this.workspacePlugin.saveWorkspace(workspaceName) : undefined
    );
  }

  registerEventHandlers() {
    this.registerEvent(this.app.workspace.on("workspace-delete", this.onWorkspaceDelete));
    this.registerEvent(this.app.workspace.on("workspace-rename", this.onWorkspaceRename));
    this.registerEvent(this.app.workspace.on("workspace-save", this.onWorkspaceSave));
    this.registerEvent(this.app.workspace.on("workspace-load", this.onWorkspaceLoad));
    this.registerEvent(this.app.workspace.on("layout-change", this.onLayoutChange));
    this.registerEvent(this.app.workspace.on("resize", this.onLayoutChange));
  }

  // Modes snapshot and restore Obsidian's entire core config (app.json, which is shared
  // across platforms). applySettings() replaces app.vault.config wholesale, so restoring a
  // desktop-captured snapshot on mobile would drop mobile-only keys (mobile toolbar, pull
  // action, etc.) and persist the loss. Until Modes captures/merges config platform-safely,
  // the feature is desktop-only regardless of the stored toggle.
  get modesEnabled(): boolean {
    return this.settings.workspaceSettings && !this.app.isMobile;
  }

  get changeWorkspaceButton() {
    return this.statusBarWorkspace?.querySelector(".status-bar-item-segment.name");
  }

  get changeModeButton() {
    return this.statusBarMode?.querySelector(".status-bar-item-segment.name");
  }

  setPlatformWorkspace(): void {
    if (!this.isNativePluginEnabled) return;
    // note: don't call this too early in the init process or it will wipe all workspaces
    const _activeWorkspace = this.app.isMobile
      ? this.settings.activeWorkspaceMobile
      : this.settings.activeWorkspaceDesktop;
    if (!_activeWorkspace) return;
    if (this.settings.restoreLayoutOnStartup) {
      // loadWorkspace (not setActiveWorkspace) so the saved layout is actually reapplied on
      // startup, not just the active-workspace label. Obsidian's own setActiveWorkspace only
      // sets that label; without an actual reload, the status bar can end up naming a
      // workspace whose layout was never restored, disagreeing with whatever Obsidian's
      // native session-restore happened to reopen. Opt-in (see TOGGLE_TEXT.restoreLayoutOnStartup
      // in settings.ts) because it also means every plugin load -- startup, and toggling the
      // plugin off/on in Community Plugins -- discards whatever unsaved layout is currently
      // on screen in favor of that workspace's last-saved copy.
      this.startupWorkspaceLoadTriggered = true;
      this.workspacePlugin.loadWorkspace(_activeWorkspace);
    } else {
      // Only update the remembered active-workspace label; leave whatever layout is already
      // on screen (e.g. Obsidian's own native session-restore) untouched.
      this.workspacePlugin.setActiveWorkspace(_activeWorkspace);
    }
  }

  toggleNativeWorkspaceRibbon(): void {
    if (this.settings.replaceNativeRibbon) {
      if (!this.nativeWorkspaceRibbonItem) {
        this.nativeWorkspaceRibbonItem = document.body.querySelector('[aria-label="Manage workspaces"]');
      }
      this.nativeWorkspaceRibbonItem?.hide();
    } else {
      this.nativeWorkspaceRibbonItem?.show();
    }
  }

  toggleWorkspaceRibbonButton(): void {
    if (this.settings.workspaceSwitcherRibbon) {
      if (!this.ribbonIconWorkspaces) {
        this.ribbonIconWorkspaces = this.addRibbonIcon("pane-layout", "Manage workspaces", async () =>
          new WorkspacesPlusPluginWorkspaceModal(this, this.settings, true).open()
        );
      }
      this.ribbonIconWorkspaces?.show();
    } else {
      this.ribbonIconWorkspaces?.hide();
    }
  }
  toggleModeRibbonButton(): void {
    if (this.modesEnabled && this.settings.modeSwitcherRibbon) {
      if (!this.ribbonIconMode) {
        this.ribbonIconMode = this.addRibbonIcon("gear", "Manage modes", async () =>
          new WorkspacesPlusPluginModeModal(this, this.settings, true).open()
        );
      }
      this.ribbonIconMode?.show();
    } else {
      this.ribbonIconMode?.hide();
    }
  }

  enableModesFeature() {
    if (this.modesEnabled) {
      this.storeGlobalSettings();
      this.addStatusBarIndicator("mode");
      this.addCommand({
        id: "open-workspaces-plus-modes",
        name: "Open mode switcher",
        callback: () => new WorkspacesPlusPluginModeModal(this, this.settings, true).open(),
      });
      if (this.startupWorkspaceLoadTriggered) {
        // setPlatformWorkspace() already fired a workspace-load (and therefore
        // onWorkspaceLoad) synchronously at startup -- avoid running it a second time.
        this.startupWorkspaceLoadTriggered = false;
      } else {
        if (this.debug) console.debug("toggle load", this.workspacePlugin.activeWorkspace);
        this.onWorkspaceLoad(this.workspacePlugin.activeWorkspace);
      }
      this.registerEvent(this.app.vault.on("config-changed", this.onConfigChange));
    }
  }

  disableModesFeature() {
    // Only undo what enableModesFeature() actually set up. It no-ops unless modesEnabled
    // (so it never runs on mobile), and statusBarMode is the marker it leaves behind.
    // Without this, toggling the persisted `workspaceSettings` off while the feature was
    // never active would run applySettings() over an empty globalSettings and wipe app.json.
    if (!this.statusBarMode) return;
    this.app.vault.off("config-changed", this.onConfigChange);
    let combinedSettings = this.mergeGlobalSettings();
    this.applySettings(combinedSettings);
    this.statusBarMode?.detach();
    this.statusBarMode = null;
    this.app.commands.removeCommand(`${this.manifest.id}:"open-workspaces-plus-modes"`);
  }

  addStatusBarIndicator(modalType: string = "workspace") {
    let statusBarItem;
    const itemName = modalType == "mode" ? "statusBarMode" : "statusBarWorkspace";
    if (this[itemName]) return;
    else statusBarItem = this[itemName] = this.addStatusBarItem();

    statusBarItem.addClass(`${modalType}-switcher`);
    statusBarItem.setAttribute("aria-label", `Switch ${modalType}`);
    statusBarItem.setAttribute("aria-label-position", "top");
    // create the status bar icon
    const icon = statusBarItem.createSpan("status-bar-item-segment icon");
    modalType == "workspace" ? setIcon(icon, "pane-layout") : setIcon(icon, "gear"); // inject svg icon
    // create the status bar text
    let modeText = this.utils.getActiveModeDisplayName();
    statusBarItem.createSpan({
      cls: "status-bar-item-segment name",
      text: !this.isNativePluginEnabled
        ? "Error: The Workspaces core plugin is disabled"
        : modalType == "workspace"
        ? this.utils.activeWorkspace
        : modeText,
      prepend: false,
    });
    // register click handler
    statusBarItem.addEventListener("click", evt => this.onStatusBarClick(evt, modalType));
  }

  onStatusBarClick(evt: MouseEvent, modalType: string) {
    if (!this.isNativePluginEnabled) return;
    // handle the shift click to save current workspace shortcut
    if (evt.shiftKey === true) {
      modalType == "mode" ? this.utils.saveActiveMode() : this.utils.saveActiveWorkspace();
      // why trigger here?
      // this.app.workspace.trigger("layout-change");
      this.registerWorkspaceHotkeys();
      new Notice("Successfully saved " + (modalType == "mode" ? "mode" : "workspace"));
    } else {
      if (modalType === "workspace") new WorkspacesPlusPluginWorkspaceModal(this, this.settings).open();
      if (modalType === "mode") new WorkspacesPlusPluginModeModal(this, this.settings).open();
    }
  }

  setWorkspaceName = debounce(
    () => {
      if (!this.isNativePluginEnabled) {
        this.changeWorkspaceButton?.setText("Error: the workspaces core plugin is disabled");
      } else {
        this.changeWorkspaceButton?.setText(this.utils.activeWorkspace);
      }
      if (this.modesEnabled) this.changeModeButton?.setText(this.utils.getActiveModeDisplayName());
    },
    100,
    true
  );

  debouncedSave = debounce(
    // avoid overly serializing the workspace during expensive operations like window resize
    (workspaceName: string) => {
      // avoid errors if the debounced save happens in the middle of a workspace switch
      if (workspaceName === this.utils.activeWorkspace) {
        if (this.debug) console.debug("layout invoked save: " + workspaceName);
        this.workspacePlugin.saveWorkspace(workspaceName);
      } else {
        if (this.debug) console.debug("skipped saving because the workspace has been changed");
      }
    },
    2000,
    true
  );

  onConfigChange = () => {
    if (!this.modesEnabled) return;
    if (this.workspaceLoading) {
      if (this.debug) console.debug("skipped save due to recent workspace switch");
      return;
    }
    const activeModeName = this.utils.activeModeName;
    if (activeModeName) {
      if (this.debug) console.debug("config invoked mode update: " + activeModeName);
      this.workspacePlugin.saveWorkspace(activeModeName);
    } else {
      if (this.debug) console.debug("config invoked global update");
      this.updateGlobalSettings();
    }
  };

  onLayoutChange = () => {
    if (!this.workspaceLoading) {
      // TODO: Handle per workspace auto save
      if (this.settings.saveOnChange) {
        this.debouncedSave(this.utils.activeWorkspace);
      }
    }
  };

  setWorkspaceAttribute() {
    const workspace = this.utils.activeWorkspace;
    document.body.dataset.workspaceName = workspace;
    if (this.modesEnabled) {
      const modeName = this.utils.getActiveModeDisplayName();
      if (modeName) document.body.dataset.workspaceMode = modeName;
    }
  }

  onWorkspaceRename = (name: string, oldName: string) => {
    this.setWorkspaceName();
    // remove the old command
    this.app.commands.removeCommand(`${this.manifest.id}:${oldName}`);
    const hotkeys = this.app.hotkeyManager.getHotkeys(`${this.manifest.id}:${oldName}`);
    // register the new command
    this.registerWorkspaceHotkeys();
    if (hotkeys) {
      // reassign any hotkeys that were assigned to the old command
      this.app.hotkeyManager.setHotkeys(this.manifest.id + ":" + name, hotkeys);
    }
    // update any cMenu buttons that were associated to the old command
    this.updateCMenuIcon(name, oldName);
    // persist changes to disk
    this.workspacePlugin.saveData();
  };

  updateCMenuIcon(name: string, oldName: string) {
    const cMenuPlugin = this.app.plugins.plugins["cmenu-plugin"];
    let cMenuItemIdx = cMenuPlugin?.settings.menuCommands.findIndex(cmd => cmd.id === `${this.manifest.id}:${oldName}`);
    if (!cMenuPlugin || cMenuItemIdx === -1) return;
    let cMenuItems = cMenuPlugin.settings.menuCommands;
    cMenuItems[cMenuItemIdx].id = `${this.manifest.id}:${name}`;
    cMenuItems[cMenuItemIdx].name = `${this.manifest.name}: Load: ${name}`;
    cMenuPlugin.saveSettings();
    // rebuild the cMenu toolbar
    dispatchEvent(new Event("cMenu-NewCommand"));
  }

  onWorkspaceDelete = (workspaceName: string) => {
    this.setWorkspaceName();
    const id = this.manifest.id + ":" + workspaceName;
    this.app.commands.removeCommand(id);
    const hotkeys = this.app.hotkeyManager.getHotkeys(id);
    if (hotkeys) {
      this.app.hotkeyManager.removeHotkeys(this.manifest.id + ":" + workspaceName, hotkeys);
    }
  };

  onWorkspaceSave = async (workspaceName: string, customSettings: WorkspaceCustomSettings | null) => {
    if (!this.isNativePluginEnabled) return;
    this.setWorkspaceName();
    this.registerWorkspaceHotkeys();

    if (!customSettings) {
      customSettings = this.utils.getWorkspaceSettings(workspaceName);
    } else {
      customSettings = this.utils.setWorkspaceSettings(workspaceName, customSettings);
    }
    
    // Capture currently open files if tracking is enabled
    if (this.settings.trackOpenFiles) {
      const currentWorkspace = this.workspacePlugin.workspaces[workspaceName];
      if (currentWorkspace) {
        const openFiles = this.utils.captureOpenFiles(currentWorkspace);
        customSettings.trackedFiles = openFiles;
      }
    }
    
    if (this.modesEnabled && this.utils.isMode(workspaceName)) {
      customSettings.app = this.app.vault.config;
    }
    
    let explorerFoldState: unknown = await this.app.loadLocalStorage("file-explorer-unfold");
    if (explorerFoldState) customSettings.explorerFoldState = explorerFoldState;

    if (this.settings.preserveRibbon) {
      this.utils.syncRibbonAcrossWorkspaces();
    }
    
    this.workspacePlugin.saveData();
  };

  updatePlatformWorkspace(name: string) {
    if (this.app.isMobile) {
      this.settings.activeWorkspaceMobile = name;
    } else {
      this.settings.activeWorkspaceDesktop = name;
    }
  }

  mergeModeSettings(settings: WorkspaceCustomSettings): Record<string, unknown> {
    return Object.assign({}, settings["app"]) as Record<string, unknown>;
  }

  mergeGlobalSettings(): Record<string, unknown> {
    return Object.assign({}, this.settings.globalSettings);
  }

  onWorkspaceLoad = (name: string) => {
    this.setWorkspaceName(); // sets status bar text
    this.setWorkspaceAttribute(); // sets HTML data attribute
    this.updatePlatformWorkspace(name);
    const settings = this.utils.getWorkspaceSettings(name);
    if (this.modesEnabled) {
      const modeName = settings?.mode;
      const mode = modeName && this.utils.getModeSettings(modeName);
      let combinedSettings;
      if (mode) {
        combinedSettings = this.mergeModeSettings(mode);
        if (this.debug) console.debug("loading mode settings", mode, combinedSettings);
      } else {
        combinedSettings = this.mergeGlobalSettings();
        if (this.debug) console.debug("loading default settings", combinedSettings);
        settings && (settings["mode"] = null);
      }
      if (this.settings.systemDarkMode) this.utils.updateDarkModeFromOS(combinedSettings);

      this.needsReload(combinedSettings) && this.reloadIfNeeded();
      this.applySettings(combinedSettings);
    }
    if (settings) this.utils.updateFoldState(settings);
    void this.saveData(this.settings);
  };

  needsReload(settings: Record<string, unknown>) {
    return this.settings.reloadLivePreview && settings.livePreview != this.app.vault.config.livePreview;
  }

  reloadIfNeeded = debounce(() => {
    function sleep(ms: number) {
      return new Promise(resolve => window.setTimeout(resolve, ms));
    }
    // this is currently the only way to tell if CM6 is actually loaded on desktop
    const isLoaded = this.app.commands.editorCommands["editor:toggle-source"] ? true : false;
    const isEnabled = this.app.vault.config.livePreview;
    if (isEnabled != isLoaded) {
      void this.app.workspace.saveLayout().then(async () => {
        while (true) {
          await sleep(100);
          if (this.app.workspace.layoutReady) {
            return window.location.reload();
          } else {
            await sleep(100);
          }
        }
      });
    }
  }, 500);

  applySettings(settings: Record<string, unknown>) {
    this.app.disableCssTransition();
    // this emulates what Obsidian does when loading the core settings
    this.app.vault.config = settings;
    this.app.vault.saveConfig();
    // this.app.workspace.updateOptions();
    this.app.setTheme(settings?.theme as string);
    this.app.customCss.setTheme(settings?.cssTheme as string);
    // this.app.changeBaseFontSize(settings?.baseFontSize as number);
    this.app.customCss.loadData();
    this.app.customCss.applyCss();
    window.setTimeout(() => {
      this.app.enableCssTransition();
    }, 1000);
  }

  registerWorkspaceHotkeys() {
    const workspaceNames = Object.keys(this.workspacePlugin.workspaces);
    for (const workspaceName of workspaceNames) {
      this.addCommand({
        id: workspaceName,
        name: `Load: ${workspaceName}`,
        callback: () => {
          this.workspacePlugin.loadWorkspace(workspaceName);
        },
      });
    }
  }

  setLoadingStatus(): void {
    this.workspaceLoading = true;
    window.setTimeout(() => {
      this.workspaceLoading = false;
    }, 2000);
  }

  updateGlobalSettings(): void {
    this.settings.globalSettings = Object.assign({}, this.settings.globalSettings, this.app.vault.config);
    void this.saveData(this.settings);
  }

  storeGlobalSettings() {
    if (Object.keys(this.settings.globalSettings).length === 0) {
      this.settings.globalSettings = Object.assign({}, this.app.vault.config);
      void this.saveData(this.settings);
    }
    return this.settings.globalSettings;
  }

  installWorkspaceHooks() {
    // patch the internal workspaces plugin to emit events on save, delete, and load
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- captured for the patched functions below, whose own `this` is rebound to workspacePlugin
    const plugin = this;
    this.register(
      around(this.workspacePlugin, {
        saveWorkspace(old) {
          return function saveWorkspace(workspaceName, ...etc) {
            // TODO: Does this prevent saving a workspace with no name?
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            let settings;
            settings = plugin.utils.getWorkspaceSettings(workspaceName);
            // old.call()'s TS typing falls back to `any` for this arity, same as bind() elsewhere in this codebase
            const result = old.call(this, workspaceName, ...etc) as unknown;
            if (plugin.debug) console.debug("workspace saved: " + workspaceName);
            this.app.workspace.trigger("workspace-save", workspaceName, settings);
            return result;
          };
        },
        deleteWorkspace(old) {
          return function deleteWorkspace(workspaceName, ...etc) {
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            // old.call()'s TS typing falls back to `any` for this arity, same as bind() elsewhere in this codebase
            const result = old.call(this, workspaceName, ...etc) as unknown;
            this.app.workspace.trigger("workspace-delete", workspaceName);
            return result;
          };
        },
        loadWorkspace(old) {
          return function loadWorkspace(workspaceName, ...etc) {
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            plugin.setLoadingStatus();
            let result;
            const currentLayoutBeforeSwitch = plugin.app.workspace.getLayout();
            
            if (plugin.modesEnabled && plugin.utils.isMode(workspaceName)) {
              // if the workspace being loaded is a mode, invoke the mode loader
              let modeName = workspaceName;
              workspaceName = plugin.utils.activeWorkspace;
              result = plugin.utils.loadMode(workspaceName, modeName);
            } else {
              const workspace = this.workspaces[workspaceName];
              if (workspace) {
                this.activeWorkspace = workspaceName;
                // Guards against a rapid second switch superseding this one while its restore
                // chain is still in flight (see the generation checks below).
                const generation = ++plugin.workspaceLoadGeneration;
                // Restore tracked files, then overrides -- sequential (not Promise.all) is
                // intentional: when the same leaf is both tracked and overridden, the override
                // must win, which only holds if it's applied after restoreOpenFiles.
                const restore: Promise<void> = plugin.settings.trackOpenFiles
                  ? plugin.utils
                      .restoreOpenFiles(workspaceName, workspace)
                      .then(() => plugin.utils.applyFileOverrides(workspaceName, workspace))
                  : plugin.utils.applyFileOverrides(workspaceName, workspace);
                restore
                  .catch((e: unknown) => {
                    // Swallow and continue to changeLayout() regardless -- both
                    // restoreOpenFiles and applyFileOverrides already isolate per-leaf
                    // errors internally, so a rejection here means something unexpected
                    // happened, not "nothing was restored."
                    console.error("failed to restore files:", e);
                  })
                  .then(async () => {
                    // A newer switch started while restore was running -- applying this
                    // (now-stale) layout would revert the user's screen back to it.
                    if (generation !== plugin.workspaceLoadGeneration) return;
                    let layoutToApply: Workspaces = workspace;
                    if (plugin.settings.preserveRibbon && currentLayoutBeforeSwitch) {
                      layoutToApply = plugin.utils.preserveRibbonInLayout(workspace, currentLayoutBeforeSwitch);
                    }
                    await this.app.workspace.changeLayout(layoutToApply);
                    if (generation !== plugin.workspaceLoadGeneration) return;
                    // changeLayout() creates the leaves, but leaves in the background stay
                    // "deferred" (a lightweight placeholder) until focused. Force-load every
                    // deferred leaf in the workspace -- not just the ones this plugin wrote a
                    // file into -- since any background leaf can be left in that state.
                    const leaves: WorkspaceLeaf[] = [];
                    this.app.workspace.iterateAllLeaves(leaf => leaves.push(leaf));
                    await Promise.all(
                      leaves
                        .filter(leaf => leaf.isDeferred)
                        .map(leaf =>
                          // Isolate each leaf. A leaf whose view type isn't registered
                          // on this device -- e.g. a desktop-only plugin's view in a
                          // layout opened on mobile/iPad -- rejects here, and an
                          // unguarded Promise.all would then abort the whole restore:
                          // saveData() is skipped and the sidebar / ribbon are left
                          // half-rebuilt until the app is reloaded. Mirrors the
                          // per-entry isolation in Utils.applyFileOverrides.
                          Promise.resolve()
                            .then(() => leaf.loadIfDeferred())
                            .catch((e: unknown) => {
                              console.error("failed to load deferred leaf:", e);
                            })
                        )
                    );
                    if (generation === plugin.workspaceLoadGeneration) this.saveData();
                  })
                  .catch((e: unknown) => {
                    console.error("failed to apply workspace layout:", e);
                  });
              }
            }
            this.app.workspace.trigger("workspace-load", workspaceName);
            return result;
          };
        },
      })
    );
  }
}
