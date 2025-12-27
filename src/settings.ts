import WorkspacesPlus from "./main";
import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import { FileSuggest } from "./suggesters/fileSuggest";

const SETTINGS_ATTR = "workspaces-plus:settings-v1";
export class WorkspacesPlusSettings {
  showInstructions: boolean;
  showDeletePrompt: boolean;
  saveOnSwitch: boolean;
  saveOnChange: boolean;
  workspaceSettings: boolean;
  systemDarkMode: boolean;
  globalSettings: Object;
  activeWorkspaceDesktop: string;
  activeWorkspaceMobile: string;
  reloadLivePreview: boolean;
  workspaceSwitcherRibbon: boolean;
  modeSwitcherRibbon: boolean;
  replaceNativeRibbon: boolean;
  trackOpenFiles: boolean;
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
};

function getChildIds (split: any, leafs: any[] = []): any[] {
  if (split.type === "leaf") {
    leafs.push({ id: split.id, file: split.state.state.file, mode: split.state.state.mode });
  } else if (split.type === "split" || split.type === "tabs") {
    split.children.forEach((child: any) => {
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
      containerEl.createEl("h2", {
        text: "Please enable the Workspaces plugin under Core Plugins before using this plugin",
      });
      return;
    }
    // containerEl.createEl("h2", { text: "Workspaces Plus" });
    containerEl.createEl("h2", {
      text: "Quick Switcher Settings",
    });
    new Setting(containerEl)
      .setName("Show instructions")
      .setDesc(`Show available keyboard shortcuts at the bottom of the workspace quick switcher`)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showInstructions).onChange(value => {
          this.plugin.settings.showInstructions = value;
          this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Show workspace delete confirmation")
      .setDesc(`Show a confirmation prompt on workspace deletion`)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showDeletePrompt).onChange(value => {
          this.plugin.settings.showDeletePrompt = value;
          this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Show Workspace Sidebar Ribbon Icon")
      // .setDesc(``)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.workspaceSwitcherRibbon).onChange(value => {
          this.plugin.settings.workspaceSwitcherRibbon = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleWorkspaceRibbonButton();
        })
      );

    new Setting(containerEl)
      .setName("Hide the native Workspace Sidebar Ribbon Icon")
      // .setDesc(``)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.replaceNativeRibbon).onChange(value => {
          this.plugin.settings.replaceNativeRibbon = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleNativeWorkspaceRibbon();
        })
      );

    new Setting(containerEl)
      .setName("Show Workspace Mode Sidebar Ribbon Icon")
      // .setDesc(``)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.modeSwitcherRibbon).onChange(value => {
          this.plugin.settings.modeSwitcherRibbon = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleModeRibbonButton();
        })
      );

    containerEl.createEl("h2", {
      text: "Workspace Enhancements",
    });

    new Setting(containerEl)
      .setName(
        createFragment(function (e) {
          e.appendText("Workspace Modes"),
            e.createSpan({
              cls: "flair mod-pop",
              text: "beta",
            });
        })
      )
      .setDesc(
        `Modes are a new type of Workspace that store all of the native Obsidian Editor, Files & Links, 
        and Appearance settings. Enabling this will add a new mode switcher to the status bar that will allow you
        to save, apply, rename, and switch between modes.`
      )
      .then(setting => {
        setting.settingEl.addClass("workspace-modes");
        if (this.plugin.settings.workspaceSettings) setting.settingEl.addClass("is-enabled");
        else setting.settingEl.removeClass("is-enabled");
        setting.addToggle(toggle =>
          toggle.setValue(this.plugin.settings.workspaceSettings).onChange(value => {
            if (value) setting.settingEl.addClass("is-enabled");
            else setting.settingEl.removeClass("is-enabled");
            this.plugin.settings.workspaceSettings = value;
            this.plugin.saveData(this.plugin.settings);
            if (value) this.plugin.enableModesFeature();
            else this.plugin.disableModesFeature();
          })
        );
      });

    new Setting(containerEl)
      .setName("Auto save the current workspace on layout change")
      .setDesc(
        `This option will auto save your current workspace on any layout change.
         Leave this disabled if you want full control over when your workspace is saved.`
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.saveOnChange).onChange(value => {
          this.plugin.settings.saveOnChange = value;
          this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Automatically track and restore open files")
      .setDesc(
        `When enabled, workspaces will remember which files were open and restore them when you switch back. ` +
        `This preserves your exact layout and open notes across workspace switches.`
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.trackOpenFiles).onChange(value => {
          this.plugin.settings.trackOpenFiles = value;
          this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Respect system dark mode setting")
      .setClass("requires-workspace-modes")
      .setDesc(
        `Let the OS determine the light/dark mode setting when switching modes. This setting can only be used if Workspace Modes is enabled.`
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.systemDarkMode).onChange(value => {
          this.plugin.settings.systemDarkMode = value;
          this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Automatically reload Obsidian on Live Preview setting change")
      .setClass("requires-workspace-modes")
      .setDesc(
        `When switching between Modes with different Experimental Live Preview settings, reload Obsidian in order for the setting
                change to take effect. ⚠️Note: Obsidian will reload automatically after changing workspaces, if needed, without any prompts.`
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.reloadLivePreview).onChange(value => {
          this.plugin.settings.reloadLivePreview = value;
          this.plugin.saveData(this.plugin.settings);
        })
      );

    containerEl.createEl("h2", {
      text: "Per Workspace Settings",
    });

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
      new Setting(subContainerEL).setName("Workspace Description").addText(textfield => {
        textfield.inputEl.type = "text";
        textfield.inputEl.parentElement?.addClass("search-input-container");
        textfield.setValue(String(workspaceSettings?.description || ""));
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

      new Setting(subContainerEL).setHeading().setName("File Overrides");

      getChildIds(workspace.main).forEach((leaf: any) => {
        let currentFile: string;
        if (workspaceSettings.fileOverrides && workspaceSettings.fileOverrides[leaf.id]) {
          currentFile = workspaceSettings.fileOverrides[leaf.id];
        } else {
          currentFile = null;
        }
        new Setting(subContainerEL)
          .setName(leaf.id ? leaf.id : "unknown")
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

    containerEl
      .createEl("h2", {
        text: "Per Mode Settings",
      })
      .addClass("requires-workspace-modes");

    Object.entries(workspaces).forEach(entry => {
      const [modeName, mode] = entry;
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
}

// setting.settingEl.addEventListener("click", (e) => {
//   setting.settingEl.toggleClass(
//     "is-collapsed",
//     !setting.settingEl.hasClass("is-collapsed")
//   );
// });