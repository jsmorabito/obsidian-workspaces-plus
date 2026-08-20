import WorkspacesPlus from "./main";
import {
  App,
  PluginSettingTab,
  Setting,
  setIcon,
  WorkspaceLayoutNode,
  Workspaces,
  SettingDefinitionItem,
  SettingGroupItem,
  SettingDefinitionPage,
} from "obsidian";
import { FileSuggest } from "./suggesters/fileSuggest";

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

interface ChildLeafSummary {
  id?: string;
  file?: string | null;
  mode?: unknown;
}

function getChildIds (split: WorkspaceLayoutNode, leafs: ChildLeafSummary[] = []): ChildLeafSummary[] {
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
      .setName("Show instructions")
      .setDesc(`Show available keyboard shortcuts at the bottom of the workspace quick switcher`)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showInstructions).onChange(value => {
          this.plugin.settings.showInstructions = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Show workspace delete confirmation")
      .setDesc(`Show a confirmation prompt on workspace deletion`)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showDeletePrompt).onChange(value => {
          this.plugin.settings.showDeletePrompt = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Show workspace sidebar ribbon icon")
      // .setDesc(``)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.workspaceSwitcherRibbon).onChange(value => {
          this.plugin.settings.workspaceSwitcherRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleWorkspaceRibbonButton();
        })
      );

    new Setting(containerEl)
      .setName("Hide the native workspace sidebar ribbon icon")
      // .setDesc(``)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.replaceNativeRibbon).onChange(value => {
          this.plugin.settings.replaceNativeRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleNativeWorkspaceRibbon();
        })
      );

    new Setting(containerEl)
      .setName("Show workspace mode sidebar ribbon icon")
      // .setDesc(``)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.modeSwitcherRibbon).onChange(value => {
          this.plugin.settings.modeSwitcherRibbon = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.toggleModeRibbonButton();
        })
      );

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
        `Modes are a new type of workspace that store all of the native Obsidian editor, files & links,
        and appearance settings. Enabling this will add a new mode switcher to the status bar that will allow you
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
            void this.plugin.saveData(this.plugin.settings);
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
          void this.plugin.saveData(this.plugin.settings);
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
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Respect system dark mode setting")
      .setClass("requires-workspace-modes")
      .setDesc(
        `Let the os determine the light/dark mode setting when switching modes. This setting can only be used if workspace modes is enabled.`
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.systemDarkMode).onChange(value => {
          this.plugin.settings.systemDarkMode = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Automatically reload Obsidian on live preview setting change")
      .setClass("requires-workspace-modes")
      .setDesc(
        `When switching between modes with different experimental live preview settings, reload Obsidian in order for the setting
                change to take effect. ⚠️note: Obsidian will reload automatically after changing workspaces, if needed, without any prompts.`
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.reloadLivePreview).onChange(value => {
          this.plugin.settings.reloadLivePreview = value;
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

      new Setting(subContainerEL).setHeading().setName("File overrides");

      getChildIds(workspace.main).forEach(leaf => {
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

  // Declarative settings API (Obsidian 1.13.0+). display() above remains the
  // fallback for older versions (minAppVersion is 1.8.7) -- Obsidian only
  // calls display() when this returns an empty array, which is what the
  // inherited default does on versions that predate this API entirely.
  // Keep the two in sync when editing either: same settings, same text,
  // necessarily different structure (imperative DOM vs. declarative tree).
  getSettingDefinitions(): SettingDefinitionItem[] {
    if (!this.plugin.utils.isNativePluginEnabled) {
      return [{ name: "Please enable the workspaces plugin under core plugins before using this plugin" }];
    }

    const { workspaces } = this.plugin.workspacePlugin;
    const workspacePages: SettingGroupItem[] = Object.keys(workspaces)
      .filter(name => !this.plugin.utils.isMode(name))
      .map(name => this.buildWorkspacePage(name, workspaces[name]));
    const modePages: SettingGroupItem[] = Object.keys(workspaces)
      .filter(name => this.plugin.utils.isMode(name))
      .map(name => this.buildModePage(name));

    return [
      {
        type: "group",
        heading: "Quick switcher",
        items: [
          {
            name: "Show instructions",
            desc: "Show available keyboard shortcuts at the bottom of the workspace quick switcher",
            control: { type: "toggle", key: "showInstructions" },
          },
          {
            name: "Show workspace delete confirmation",
            desc: "Show a confirmation prompt on workspace deletion",
            control: { type: "toggle", key: "showDeletePrompt" },
          },
          {
            name: "Show workspace sidebar ribbon icon",
            control: { type: "toggle", key: "workspaceSwitcherRibbon" },
          },
          {
            name: "Hide the native workspace sidebar ribbon icon",
            control: { type: "toggle", key: "replaceNativeRibbon" },
          },
          {
            name: "Show workspace mode sidebar ribbon icon",
            control: { type: "toggle", key: "modeSwitcherRibbon" },
          },
        ],
      },
      {
        type: "group",
        heading: "Workspace enhancements",
        items: [
          {
            name: "Workspace modes (beta)",
            desc: "Modes are a new type of workspace that store all of the native Obsidian editor, files & links, and appearance settings. Enabling this will add a new mode switcher to the status bar that will allow you to save, apply, rename, and switch between modes.",
            control: { type: "toggle", key: "workspaceSettings" },
          },
          {
            name: "Auto save the current workspace on layout change",
            desc: "This option will auto save your current workspace on any layout change. Leave this disabled if you want full control over when your workspace is saved.",
            control: { type: "toggle", key: "saveOnChange" },
          },
          {
            name: "Automatically track and restore open files",
            desc: "When enabled, workspaces will remember which files were open and restore them when you switch back. This preserves your exact layout and open notes across workspace switches.",
            control: { type: "toggle", key: "trackOpenFiles" },
          },
          {
            name: "Respect system dark mode setting",
            desc: "Let the os determine the light/dark mode setting when switching modes. This setting can only be used if workspace modes is enabled.",
            control: { type: "toggle", key: "systemDarkMode" },
            visible: () => this.plugin.settings.workspaceSettings,
          },
          {
            name: "Automatically reload Obsidian on live preview setting change",
            desc: "When switching between modes with different experimental live preview settings, reload Obsidian in order for the setting change to take effect. ⚠️note: Obsidian will reload automatically after changing workspaces, if needed, without any prompts.",
            control: { type: "toggle", key: "reloadLivePreview" },
            visible: () => this.plugin.settings.workspaceSettings,
          },
        ],
      },
      { type: "group", heading: "Per workspace", items: workspacePages },
      {
        type: "group",
        heading: "Per mode",
        items: modePages,
        visible: () => this.plugin.settings.workspaceSettings,
      },
    ];
  }

  private buildWorkspacePage(workspaceName: string, workspace: Workspaces): SettingDefinitionPage {
    const overrides: SettingGroupItem[] = getChildIds(workspace.main).map(leaf => ({
      name: leaf.id ?? "unknown",
      control: {
        type: "file",
        key: `workspace-override:${encodeURIComponent(workspaceName)}:${encodeURIComponent(leaf.id ?? "")}`,
        placeholder: leaf.file ?? "",
      },
    }));

    return {
      type: "page",
      name: workspaceName,
      items: [
        {
          name: "Workspace description",
          control: { type: "text", key: `workspace-description:${encodeURIComponent(workspaceName)}` },
        },
        { type: "group", heading: "File overrides", items: overrides },
      ],
    };
  }

  private buildModePage(modeName: string): SettingDefinitionPage {
    return {
      type: "page",
      name: modeName.replace(/^mode: /i, ""),
      items: [
        {
          name: "Save and load left/right sidebar state",
          control: { type: "toggle", key: `mode-save-sidebar:${encodeURIComponent(modeName)}` },
        },
      ],
    };
  }

  getControlValue(key: string): unknown {
    if (key.startsWith("workspace-description:")) {
      const workspaceName = decodeURIComponent(key.slice("workspace-description:".length));
      return this.plugin.utils.getWorkspaceSettings(workspaceName)?.description ?? "";
    }
    if (key.startsWith("workspace-override:")) {
      const { workspaceName, leafId } = this.parseOverrideKey(key);
      return this.plugin.utils.getWorkspaceSettings(workspaceName)?.fileOverrides?.[leafId] ?? "";
    }
    if (key.startsWith("mode-save-sidebar:")) {
      const modeName = decodeURIComponent(key.slice("mode-save-sidebar:".length));
      return this.plugin.utils.getModeSettings(modeName)?.saveSidebar ?? false;
    }
    // invoked by Obsidian itself when getSettingDefinitions() is in play, i.e. on 1.13.0+; display() is the fallback
    // for 1.8.7-1.12.x, where these methods are simply never called. See the comment above getSettingDefinitions().
    return super.getControlValue(key);
  }

  setControlValue(key: string, value: unknown): void {
    if (key.startsWith("workspace-description:")) {
      const workspaceName = decodeURIComponent(key.slice("workspace-description:".length));
      const settings = this.plugin.utils.getWorkspaceSettings(workspaceName);
      if (settings) settings.description = value as string;
      this.plugin.workspacePlugin.saveData();
      return;
    }
    if (key.startsWith("workspace-override:")) {
      const { workspaceName, leafId } = this.parseOverrideKey(key);
      const settings = this.plugin.utils.getWorkspaceSettings(workspaceName);
      if (settings) {
        if (!settings.fileOverrides) settings.fileOverrides = {};
        const overrideFile = value as string;
        if (overrideFile) settings.fileOverrides[leafId] = overrideFile;
        else delete settings.fileOverrides[leafId];
      }
      this.plugin.workspacePlugin.saveData();
      return;
    }
    if (key.startsWith("mode-save-sidebar:")) {
      const modeName = decodeURIComponent(key.slice("mode-save-sidebar:".length));
      const settings = this.plugin.utils.getModeSettings(modeName);
      if (settings) settings.saveSidebar = value as boolean;
      this.plugin.workspacePlugin.saveData();
      return;
    }

    void super.setControlValue(key, value);

    switch (key) {
      case "workspaceSwitcherRibbon":
        this.plugin.toggleWorkspaceRibbonButton();
        break;
      case "replaceNativeRibbon":
        this.plugin.toggleNativeWorkspaceRibbon();
        break;
      case "modeSwitcherRibbon":
        this.plugin.toggleModeRibbonButton();
        break;
      case "workspaceSettings":
        if (value) this.plugin.enableModesFeature();
        else this.plugin.disableModesFeature();
        this.update();
        break;
    }
  }

  private parseOverrideKey(key: string): { workspaceName: string; leafId: string } {
    const rest = key.slice("workspace-override:".length);
    const sepIndex = rest.indexOf(":");
    return {
      workspaceName: decodeURIComponent(rest.slice(0, sepIndex)),
      leafId: decodeURIComponent(rest.slice(sepIndex + 1)),
    };
  }
}

// setting.settingEl.addEventListener("click", (e) => {
//   setting.settingEl.toggleClass(
//     "is-collapsed",
//     !setting.settingEl.hasClass("is-collapsed")
//   );
// });
