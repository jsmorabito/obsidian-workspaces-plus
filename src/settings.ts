import WorkspacesPlus from "./main";
import {
  App,
  ColorComponent,
  Notice,
  PluginSettingTab,
  Setting,
  setIcon,
  WorkspaceCustomSettings,
  WorkspaceLayoutNode,
  SettingDefinitionItem,
} from "obsidian";
import { FileSuggest } from "./suggesters/fileSuggest";
import { IconSuggest } from "./suggesters/iconSuggest";
import { createConfirmationDialog } from "./confirm";
import {
  getSettingDefinitions as declarativeGetSettingDefinitions,
  getControlValue as declarativeGetControlValue,
  setControlValue as declarativeSetControlValue,
} from "./settingsDeclarative";

interface ToggleText {
  name?: string;
  desc?: string;
}

// What to display next to each workspace in the quick switcher: its assigned custom hotkey
// (addresses issue #116) or a Linear-style position number (1-9) that can be pressed to jump
// straight to that workspace. Kept mutually exclusive -- rendering both at once would make it
// unclear whether a badge indicates the workspace's real hotkey or just its list position, and a
// custom hotkey (e.g. Alt+1) has no relationship to the position-based number a user might expect
// to press for that same row.
export type WorkspaceBadgeMode = "hotkey" | "number";

export const WORKSPACE_BADGE_OPTIONS: Record<WorkspaceBadgeMode, string> = {
  hotkey: "Custom hotkeys",
  number: "Number keys (1-9)",
};

export const WORKSPACE_BADGES_TEXT: ToggleText = {
  name: "Workspace switcher badges",
  desc: "Show each workspace's assigned hotkey, or a number (1-9) you can press to jump straight to it.",
};

// Falls back to this plugin's own existing default workspace icon (used for the status bar
// segment in main.ts) when a workspace has no custom icon set, so an unconfigured workspace looks
// the same in the switcher as it always has elsewhere in the plugin.
export const DEFAULT_WORKSPACE_ICON = "pane-layout";

// Purely the color swatch shown before a workspace has a custom icon color -- never written to a
// workspace's settings on its own; only picking a color (or resetting away from one) does that.
export const DEFAULT_ICON_COLOR_SWATCH = "#888888";

// Builds the "Workspace icon" control (a text field with icon-name autocomplete, plus a live
// preview) shared between display() (pre-1.13.0) and getSettingDefinitions()'s render callback
// (1.13.0+), so the two can't drift the way two independently hand-rolled UIs would.
export function buildWorkspaceIconSetting(
  setting: Setting,
  app: App,
  workspaceSettings: WorkspaceCustomSettings,
  onSave: () => void
): void {
  const previewEl = createSpan({ cls: "workspace-icon-preview" });
  setIcon(previewEl, workspaceSettings.icon || DEFAULT_WORKSPACE_ICON);
  setting.controlEl.prepend(previewEl);
  setting.addText(text => {
    text.inputEl.type = "text";
    text.setPlaceholder(DEFAULT_WORKSPACE_ICON);
    text.setValue(workspaceSettings.icon ?? "");
    new IconSuggest(app, text.inputEl);
    text.onChange(value => {
      const iconId = value.trim();
      if (iconId) workspaceSettings.icon = iconId;
      else delete workspaceSettings.icon;
      onSave();
      setIcon(previewEl, iconId || DEFAULT_WORKSPACE_ICON);
    });
  });
}

// Same sharing rationale as buildWorkspaceIconSetting() above. The color picker itself has no
// "unset" state (it's a native color input, always showing some color), so a reset button is
// needed to actually clear iconColor back to "use the app's default" rather than just setting it
// to this swatch's own value.
export function buildWorkspaceIconColorSetting(setting: Setting, workspaceSettings: WorkspaceCustomSettings, onSave: () => void): void {
  let colorPicker: ColorComponent;
  setting
    .addColorPicker(picker => {
      colorPicker = picker;
      picker.setValue(workspaceSettings.iconColor || DEFAULT_ICON_COLOR_SWATCH).onChange(value => {
        workspaceSettings.iconColor = value;
        onSave();
      });
    })
    .addExtraButton(button => {
      button
        .setIcon("rotate-ccw")
        .setTooltip("Reset to default color")
        .onClick(() => {
          delete workspaceSettings.iconColor;
          onSave();
          colorPicker.setValue(DEFAULT_ICON_COLOR_SWATCH);
        });
    });
}

// Shared between display() and getSettingDefinitions()'s render callback, same rationale as the
// icon settings above. Commits on blur/Enter rather than on every keystroke (unlike the other
// per-workspace text fields) because a successful rename changes the workspace's key -- every
// other control on this page (file overrides, the other two icon settings) is keyed by the old
// name and needs a full refresh (onRenamed) once it changes, which isn't something you want
// firing after every character typed.
export function buildWorkspaceRenameSetting(
  setting: Setting,
  plugin: WorkspacesPlus,
  workspaceName: string,
  onRenamed: () => void
): void {
  setting.addText(text => {
    text.setValue(workspaceName);
    const commit = () => {
      const newName = text.inputEl.value;
      if (newName.trim() === workspaceName) {
        text.setValue(workspaceName);
        return;
      }
      const result = plugin.utils.renameWorkspace(workspaceName, newName);
      if (result.success) {
        new Notice(`Renamed workspace to "${newName.trim()}"`);
        onRenamed();
      } else {
        if (result.reason) new Notice(result.reason);
        text.setValue(workspaceName);
      }
    };
    text.inputEl.addEventListener("blur", commit);
    text.inputEl.addEventListener("keydown", evt => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        text.inputEl.blur();
      }
    });
  });
}

// Same sharing rationale as the icon/rename settings above. Always confirms (unlike the quick
// switcher's own delete, which skips the prompt when showDeletePrompt is off) since this is a
// deliberate settings-page action rather than a quick inline one, and warns specifically about
// the active workspace since deleting it means Utils.deleteWorkspace() switches you to a
// different one out from under you rather than leaving you on a now-nonexistent workspace.
export function buildWorkspaceDeleteSetting(
  setting: Setting,
  plugin: WorkspacesPlus,
  workspaceName: string,
  onDeleted: () => void
): void {
  const isActive = plugin.utils.activeWorkspace === workspaceName;
  setting
    .setDesc(
      isActive
        ? "This cannot be undone. This is your current workspace, so deleting it will switch you to a different one."
        : "This cannot be undone."
    )
    .addButton(button =>
      button
        .setButtonText("Delete")
        // setDestructive() would need minAppVersion 1.13.0, above this plugin's actual minimum
        // (1.8.7) -- setWarning() is deprecated in favor of it, but still the only destructive
        // button styling available across that whole supported range.
        .setWarning()
        .onClick(() => {
          createConfirmationDialog(plugin.app, {
            cta: "Delete",
            title: "Delete workspace",
            text: isActive
              ? `Delete the "${workspaceName}" workspace? This is your current workspace, so deleting it will switch you to a different one.`
              : `Delete the "${workspaceName}" workspace? This cannot be undone.`,
            onAccept: async () => {
              plugin.utils.deleteWorkspace(workspaceName);
              onDeleted();
            },
          });
        })
    );
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
  showWorkspaceDescriptions: {
    name: "Show workspace descriptions in switcher",
    desc: "Show each workspace's description (set under Per workspace below) beneath its name in the quick switcher.",
  },
  showWorkspaceIconInSwitcher: {
    name: "Show workspace icon in quick switcher",
    desc: "Show each workspace's icon (set under Per workspace below) next to its name in the quick switcher.",
  },
  showWorkspaceIconInStatusBar: {
    name: "Show workspace icon in status bar",
    desc: "Show the active workspace's icon (set under Per workspace below) in place of the default icon in the status bar.",
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
  preserveSidebarLayout: {
    name: "Preserve sidebar layout across workspaces",
    desc: "Keep the current left and right sidebar panes, their arrangement, and view state when switching workspaces instead of loading each workspace's saved sidebar layout.",
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
  showWorkspaceDescriptions: boolean;
  showWorkspaceIconInSwitcher: boolean;
  showWorkspaceIconInStatusBar: boolean;
  workspaceBadges: WorkspaceBadgeMode;
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
  preserveSidebarLayout: boolean;
  restoreLayoutOnStartup: boolean;
}

export const DEFAULT_SETTINGS: WorkspacesPlusSettings = {
  showInstructions: true,
  showDeletePrompt: true,
  showWorkspaceDescriptions: false,
  showWorkspaceIconInSwitcher: false,
  showWorkspaceIconInStatusBar: false,
  workspaceBadges: "hotkey",
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
  preserveSidebarLayout: false,
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

  // Thin wrapper so internal refreshes (e.g. after a rename, see buildWorkspaceRenameSetting's
  // onRenamed below) can call renderSettings() directly instead of this deprecated override --
  // this project's lint config forbids suppressing that warning, and re-running Obsidian's own
  // display() lifecycle method isn't otherwise necessary for a plain internal re-render.
  display (): void {
    this.renderSettings();
  }

  renderSettings (): void {
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
      .setName(TOGGLE_TEXT.showWorkspaceDescriptions.name)
      .setDesc(TOGGLE_TEXT.showWorkspaceDescriptions.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showWorkspaceDescriptions).onChange(value => {
          this.plugin.settings.showWorkspaceDescriptions = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showWorkspaceIconInSwitcher.name)
      .setDesc(TOGGLE_TEXT.showWorkspaceIconInSwitcher.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showWorkspaceIconInSwitcher).onChange(value => {
          this.plugin.settings.showWorkspaceIconInSwitcher = value;
          void this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName(TOGGLE_TEXT.showWorkspaceIconInStatusBar.name)
      .setDesc(TOGGLE_TEXT.showWorkspaceIconInStatusBar.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showWorkspaceIconInStatusBar).onChange(value => {
          this.plugin.settings.showWorkspaceIconInStatusBar = value;
          void this.plugin.saveData(this.plugin.settings);
          this.plugin.updateStatusBarIcon();
        })
      );

    new Setting(containerEl)
      .setName(WORKSPACE_BADGES_TEXT.name)
      .setDesc(WORKSPACE_BADGES_TEXT.desc)
      .addDropdown(dropdown =>
        dropdown
          .addOptions(WORKSPACE_BADGE_OPTIONS)
          .setValue(this.plugin.settings.workspaceBadges)
          .onChange(value => {
            this.plugin.settings.workspaceBadges = value as WorkspaceBadgeMode;
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
      .setName(TOGGLE_TEXT.preserveSidebarLayout.name)
      .setDesc(TOGGLE_TEXT.preserveSidebarLayout.desc)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.preserveSidebarLayout).onChange(value => {
          this.plugin.settings.preserveSidebarLayout = value;
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

    new Setting(containerEl)
      .setName("Workspaces")
      .setHeading()
      .addExtraButton(button =>
        button
          .setIcon("plus")
          .setTooltip("Create a new blank workspace")
          .onClick(() => {
            const { name } = this.plugin.utils.createBlankWorkspace();
            new Notice(`Created workspace "${name}" -- click it below to rename or configure it.`);
            this.renderSettings();
          })
      );

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
      new Setting(subContainerEL)
        .setName("Workspace name")
        .setDesc("Renaming here also reassigns any hotkey already set for this workspace.")
        .then(setting =>
          buildWorkspaceRenameSetting(setting, this.plugin, workspaceName, () => this.renderSettings())
        );
      new Setting(subContainerEL).setName("Workspace description").addText(textfield => {
        textfield.inputEl.type = "text";
        textfield.inputEl.parentElement?.addClass("search-input-container");
        textfield.setValue(String(workspaceSettings?.description ?? ""));
        textfield.onChange(value => {
          workspaceSettings.description = value;
          this.plugin.workspacePlugin.saveData();
        });
      });

      new Setting(subContainerEL)
        .setName("Workspace icon")
        .setDesc("Shown next to the workspace name in the quick switcher. Leave blank to use the default icon.")
        .then(setting =>
          buildWorkspaceIconSetting(setting, this.app, workspaceSettings, () => this.plugin.workspacePlugin.saveData())
        );

      new Setting(subContainerEL)
        .setName("Workspace icon color")
        .then(setting => buildWorkspaceIconColorSetting(setting, workspaceSettings, () => this.plugin.workspacePlugin.saveData()));

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

      new Setting(subContainerEL)
        .setName("Delete this workspace")
        .then(setting => buildWorkspaceDeleteSetting(setting, this.plugin, workspaceName, () => this.renderSettings()));
    });

    new Setting(containerEl).setName("Modes").setHeading().setClass("requires-workspace-modes");

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
