import WorkspacesPlus from "./main";
import { App, PluginSettingTab, Setting, setIcon, WorkspaceLayoutNode, SettingDefinitionItem } from "obsidian";
import { FileSuggest } from "./suggesters/fileSuggest";
import {
  getSettingDefinitions as declarativeGetSettingDefinitions,
  getControlValue as declarativeGetControlValue,
  setControlValue as declarativeSetControlValue,
} from "./settingsDeclarative";

interface ToggleText {
  name?: string;
  desc?: string;
}

// Shared name/desc text for the plugin's toggle settings, consumed by both display() (the
// pre-1.13.0 fallback) and getSettingDefinitions() (the 1.13.0+ declarative UI) so the two
// separately-structured implementations can't silently drift apart on wording. Keyed by the
// WorkspacesPlusSettings property each toggle controls; "workspaceSettings" is the one
// exception -- it only holds desc text here since display() renders its name with an extra
// "beta" flair badge that has no equivalent in the declarative API's string-only name field.
export const TOGGLE_TEXT: Record<string, ToggleText> = {
  showInstructions: {
    name: "Show instructions",
    desc: "Show available keyboard shortcuts at the bottom of the workspace quick switcher",
  },
  showDeletePrompt: {
    name: "Show workspace delete confirmation",
    desc: "Show a confirmation prompt on workspace deletion",
  },
  workspaceSwitcherRibbon: { name: "Show workspace sidebar ribbon icon" },
  replaceNativeRibbon: { name: "Hide the native workspace sidebar ribbon icon" },
  modeSwitcherRibbon: { name: "Show workspace mode sidebar ribbon icon" },
  workspaceSettings: {
    // name intentionally omitted -- display() renders its own name via createFragment (see
    // below) to add the "beta" flair badge, and getSettingDefinitions() uses its own literal
    // "Workspace modes (beta)" string since the declarative API's name field is string-only.
    desc:
      "Modes are a new type of workspace that store all of the native Obsidian editor, files & links, " +
      "and appearance settings. Enabling this will add a new mode switcher to the status bar that will allow you " +
      "to save, apply, rename, and switch between modes.",
  },
  saveOnChange: {
    name: "Auto save the current workspace on layout change",
    desc:
      "This option will auto save your current workspace on any layout change. " +
      "Leave this disabled if you want full control over when your workspace is saved.",
  },
  preserveRibbon: {
    name: "Preserve ribbon icons across workspaces",
    desc: "Keep the current left ribbon icons and their order when switching workspaces instead of loading each workspace's saved ribbon state.",
  },
  trackOpenFiles: {
    name: "Automatically track and restore open files",
    desc:
      "When enabled, workspaces will remember which files were open and restore them when you switch back. " +
      "This preserves your exact layout and open notes across workspace switches.",
  },
  systemDarkMode: {
    name: "Respect system dark mode setting",
    desc: "Let the os determine the light/dark mode setting when switching modes. This setting can only be used if workspace modes is enabled.",
  },
  reloadLivePreview: {
    name: "Automatically reload Obsidian on live preview setting change",
    desc:
      "When switching between modes with different experimental live preview settings, reload Obsidian in order for the setting " +
      "change to take effect. ⚠️note: Obsidian will reload automatically after changing workspaces, if needed, without any prompts.",
  },
  restoreLayoutOnStartup: {
    name: "Reload workspace layout on startup",
    desc:
      "Reapply the last-used workspace's saved layout on every Obsidian launch, and when this plugin is toggled off and on " +
      "again in Community Plugins, so the workspace switcher always agrees with what's on screen. ⚠️note: this discards any " +
      "unsaved changes to the current layout in favor of that workspace's last-saved copy. Leave this disabled to let " +
      "Obsidian's own session restore reopen whatever was on screen, unsaved changes included.",
  },
};

export class WorkspacesPlusSettings {
  showInstructions: boolean;
  showDeletePrompt: boolean;
  saveOnSwitch: boolean;
  saveOnChange: boolean;
  workspaceSettings: boolean;
  systemDarkMode: boolean;
  globalSettings: Record<string, unknown>;
  activeWorkspaceDesktop: string;
  activeWorkspaceMobile: string;
  reloadLivePreview: boolean;
  workspaceSwitcherRibbon: boolean;
  modeSwitcherRibbon: boolean;
  replaceNativeRibbon: boolean;
  trackOpenFiles: boolean;
  preserveRibbon: boolean;
  restoreLayoutOnStartup: boolean;
}

export const DEFAULT_SETTINGS: WorkspacesPlusSettings = {
  showInstructions: true,
  showDeletePrompt: true,
  saveOnSwitch: false,
  saveOnChange: false,
  workspaceSettings: false,
  systemDarkMode: false,
  globalSettings: {},
  activeWorkspaceDesktop: "",
  activeWorkspaceMobile: "",
  reloadLivePreview: false,
  workspaceSwitcherRibbon: false,
  modeSwitcherRibbon: false,
  replaceNativeRibbon: false,
  trackOpenFiles: true,
  preserveRibbon: false,
  restoreLayoutOnStartup: false,
};

interface ChildLeafSummary {
  id?: string;
  file?: string | null;
  mode?: unknown;
}

export function getChildIds (split: WorkspaceLayoutNode, leafs: ChildLeafSummary[] = []): ChildLeafSummary[] {
  if (split.type === "leaf") {
    leafs.push({ id: split.id, file: split.state?.state?.file, mode: split.state?.state?.mode });
  } else if (split.type === "split" || split.type === "tabs") {
    split.children?.forEach(child => {
      getChildIds(child, leafs);
    });
  }
  return leafs;
}

export class WorkspacesPlusSettingsTab extends PluginSettingTab {
  plugin: WorkspacesPlus;

  constructor (app: App, plugin: WorkspacesPlus) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display (): void {
    const { containerEl } = this;
    containerEl.empty();

    if (!this.plugin.utils.isNativePluginEnabled) {
      new Setting(containerEl)
        .setName("Please enable the workspaces plugin under core plugins before using this plugin")
        .setHeading();
      return;
    }
    new Setting(containerEl).setName("Quick switcher").setHeading();
    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showInstructions.name)
      .setDesc(TOGGLE_TEXT.showInstructions.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showInstructions).onChange(value => {
          this.plugin.settings.showInstructions = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showDeletePrompt.name)
      .setDesc(TOGGLE_TEXT.showDeletePrompt.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showDeletePrompt).onChange(value => {
          this.plugin.settings.showDeletePrompt = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.workspaceSwitcherRibbon.name)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.workspaceSwitcherRibbon).onChange(value => {
          this.plugin.settings.workspaceSwitcherRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleWorkspaceRibbonButton();
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.replaceNativeRibbon.name)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.replaceNativeRibbon).onChange(value => {
          this.plugin.settings.replaceNativeRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleNativeWorkspaceRibbon();
        })
      );

    if (!this.plugin.app.isMobile) {
      new Setting(containerEl)
        .setName(TOGGLE_TEXT.modeSwitcherRibbon.name)
        .addToggle(toggle =>
          toggle.setValue(this.plugin.settings.modeSwitcherRibbon).onChange(value => {
            this.plugin.settings.modeSwitcherRibbon = value;
            void this.plugin.saveData(this.plugin.settings);
            this.plugin.toggleModeRibbonButton();
          })
        );
    }

    new Setting(containerEl).setName("Workspace enhancements").setHeading();

    new Setting(containerEl)
      .setName(
        createFragment(function (e) {
          e.appendText("Workspace Modes");
          e.createSpan({
            cls: "flair mod-pop",
            text: "beta",
          });
        })
      )
      .setDesc(
        this.plugin.app.isMobile
          ? "Workspace modes are desktop only -- they snapshot and restore Obsidian's core config, which is shared with mobile and would overwrite mobile-specific settings. Plain workspace switching works normally on mobile."
          : TOGGLE_TEXT.workspaceSettings.desc
      )
      .then(setting => {
        setting.settingEl.addClass("workspace-modes");
        if (this.plugin.settings.workspaceSettings && !this.plugin.app.isMobile) setting.settingEl.addClass("is-enabled");
        else setting.settingEl.removeClass("is-enabled");
        setting.addToggle(toggle => {
          toggle.setValue(this.plugin.settings.workspaceSettings).onChange(value => {
            if (value) setting.settingEl.addClass("is-enabled");
            else setting.settingEl.removeClass("is-enabled");
            this.plugin.settings.workspaceSettings = value;
            void this.plugin.saveData(this.plugin.settings);
            if (value) this.plugin.enableModesFeature();
            else this.plugin.disableModesFeature();
          });
          if (this.plugin.app.isMobile) toggle.setDisabled(true);
        });
      });

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.saveOnChange.name)
      .setDesc(TOGGLE_TEXT.saveOnChange.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.saveOnChange).onChange(value => {
          this.plugin.settings.saveOnChange = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.trackOpenFiles.name)
      .setDesc(TOGGLE_TEXT.trackOpenFiles.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.trackOpenFiles).onChange(value => {
          this.plugin.settings.trackOpenFiles = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.preserveRibbon.name)
      .setDesc(TOGGLE_TEXT.preserveRibbon.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.preserveRibbon).onChange(value => {
          this.plugin.settings.preserveRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.systemDarkMode.name)
      .setClass("requires-workspace-modes")
      .setDesc(TOGGLE_TEXT.systemDarkMode.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.systemDarkMode).onChange(value => {
          this.plugin.settings.systemDarkMode = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.reloadLivePreview.name)
      .setClass("requires-workspace-modes")
      .setDesc(TOGGLE_TEXT.reloadLivePreview.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.reloadLivePreview).onChange(value => {
          this.plugin.settings.reloadLivePreview = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.restoreLayoutOnStartup.name)
      .setDesc(TOGGLE_TEXT.restoreLayoutOnStartup.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.restoreLayoutOnStartup).onChange(value => {
          this.plugin.settings.restoreLayoutOnStartup = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl).setName("Per workspace").setHeading();

    let { workspaces } = this.plugin.workspacePlugin;
    Object.entries(workspaces).forEach(entry => {
      const [workspaceName, workspace] = entry;
      const workspaceSettings = this.plugin.utils.getWorkspaceSettings(workspaceName);

      if (this.plugin.utils.isMode(workspaceName)) return;

      // containerEl.createEl("h3", {
      //   text: workspaceName,
      // });

      new Setting(containerEl)
        .setHeading()
        .setClass("settings-heading")
        .setName(workspaceName)
        .then(setting => {
          setting.settingEl.addClass("is-collapsed");

          const iconContainer = createSpan({
            cls: "settings-collapse-indicator",
          });

          setIcon(iconContainer, "right-triangle");

          setting.nameEl.prepend(iconContainer);

          setting.settingEl.addEventListener("click", e => {
            setting.settingEl.toggleClass("is-collapsed", !setting.settingEl.hasClass("is-collapsed"));
          });
        });
      const subContainerEL = containerEl.createDiv({ cls: "settings-container" });
      new Setting(subContainerEL).setName("Workspace description").addText(textfield => {
        textfield.inputEl.type = "text";
        textfield.inputEl.parentElement?.addClass("search-input-container");
        textfield.setValue(String(workspaceSettings?.description ?? ""));
        textfield.onChange(value => {
          workspaceSettings.description = value;
          this.plugin.workspacePlugin.saveData();
        });
      });

      // new Setting(containerEl)
      //   .setName(`Auto save workspace on changes (not yet implemented)`)
      //   // .setDesc(``)
      //   .addToggle(toggle =>
      //     toggle.setValue(workspaceSettings?.autoSave).onChange(value => {
      //       workspaceSettings.autoSave = value;
      //       this.plugin.workspacePlugin.saveData();
      //     })
      //   );

      new Setting(subContainerEL).setHeading().setName("File overrides");

      // Leaves without an id can't be targeted by setChildId (it matches on split.id ===
      // leafId), so an override entry keyed by a missing id could never actually apply --
      // skip rendering a control for them rather than let several such leaves collide on
      // the same fileOverrides[""] entry.
      getChildIds(workspace.main)
        .filter(leaf => leaf.id)
        .forEach(leaf => {
        let currentFile: string;
        if (workspaceSettings.fileOverrides && workspaceSettings.fileOverrides[leaf.id]) {
          currentFile = workspaceSettings.fileOverrides[leaf.id];
        } else {
          currentFile = null;
        }
        new Setting(subContainerEL)
          .setName(leaf.id)
          .setClass("file-override")
          .addSearch(cb => {
            new FileSuggest(this.app, cb.inputEl);
            cb.setPlaceholder(leaf.file ? leaf.file : "");
            if (currentFile) cb.setValue(currentFile);
            // TODO: Allow for assigning names to pane IDs
            cb.onChange(overrideFile => {
              // store leaf ID and filename override to workspace settings
              // the workspace load function will look for overrides and apply them
              // need to create a function that can search for a leaf id and update it
              if (!workspaceSettings.fileOverrides) workspaceSettings.fileOverrides = {};
              if (overrideFile) workspaceSettings.fileOverrides[leaf.id] = overrideFile;
              else delete workspaceSettings.fileOverrides[leaf.id];
            });
          });
      });
    });

    new Setting(containerEl).setName("Per mode").setHeading().setClass("requires-workspace-modes");

    Object.entries(workspaces).forEach(entry => {
      const [modeName] = entry;
      if (!this.plugin.utils.isMode(modeName)) return;
      const modeSettings = this.plugin.utils.getModeSettings(modeName);

      new Setting(containerEl)
        .setHeading()
        .setClass("settings-heading")
        .setClass("requires-workspace-modes")
        .setName(modeName?.replace(/^mode: /i, ""))
        .then(setting => {
          setting.settingEl.addClass("is-collapsed");

          const iconContainer = createSpan({
            cls: "settings-collapse-indicator",
          });

          setIcon(iconContainer, "right-triangle");

          setting.nameEl.prepend(iconContainer);

          setting.settingEl.addEventListener("click", e => {
            setting.settingEl.toggleClass("is-collapsed", !setting.settingEl.hasClass("is-collapsed"));
          });
        });

      const subContainerEL = containerEl.createDiv({ cls: "settings-container" });

      new Setting(subContainerEL)
        .setName(`Save and load left/right sidebar state`)
        .setClass("requires-workspace-modes")
        // .setDesc(``)
        .addToggle(toggle =>
          toggle.setValue(modeSettings?.saveSidebar).onChange(value => {
            modeSettings.saveSidebar = value;
            this.plugin.workspacePlugin.saveData();
          })
        );
    });
  }

  // Declarative settings API (Obsidian 1.13.0+). display() above remains the fallback for
  // older versions (minAppVersion is 1.8.7) -- Obsidian only calls display() when
  // getSettingDefinitions() returns an empty array, which is what the inherited default does
  // on versions that predate this API entirely. The actual implementation lives in
  // settingsDeclarative.ts (not here) so eslint.config.mjs's obsidianmd/no-unsupported-api
  // override can be scoped to just that file instead of this whole one -- these three methods
  // are the only things in this class that are 1.13.0+-only.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return declarativeGetSettingDefinitions(this);
  }

  getControlValue(key: string): unknown {
    return declarativeGetControlValue(this, key);
  }

  setControlValue(key: string, value: unknown): void {
    declarativeSetControlValue(this, key, value);
  }
}

// setting.settingEl.addEventListener("click", (e) => {
//   setting.settingEl.toggleClass(
//     "is-collapsed",
//     !setting.settingEl.hasClass("is-collapsed")
//   );
// });
