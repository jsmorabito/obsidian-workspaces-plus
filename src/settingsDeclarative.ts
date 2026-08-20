// Obsidian's declarative settings API (getSettingDefinitions/getControlValue/setControlValue),
// used by WorkspacesPlusSettingsTab on Obsidian 1.13.0+ only -- display() in settings.ts remains
// the fallback for 1.8.7-1.12.x. Split into its own file (rather than living directly on the
// class in settings.ts) purely so eslint.config.mjs's obsidianmd/no-unsupported-api override can
// be scoped to just these 1.13.0+-only methods, instead of the whole settings.ts file -- that
// keeps the check active for display() and the rest of the settings tab.
import { PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem, SettingDefinitionPage, Workspaces } from "obsidian";
import type { WorkspacesPlusSettingsTab } from "./settings";
import { TOGGLE_TEXT, getChildIds } from "./settings";

export function getSettingDefinitions(tab: WorkspacesPlusSettingsTab): SettingDefinitionItem[] {
  if (!tab.plugin.utils.isNativePluginEnabled) {
    return [{ name: "Please enable the workspaces plugin under core plugins before using this plugin" }];
  }

  const { workspaces } = tab.plugin.workspacePlugin;
  const workspacePages: SettingGroupItem[] = Object.keys(workspaces)
    .filter(name => !tab.plugin.utils.isMode(name))
    .map(name => buildWorkspacePage(tab, name, workspaces[name]));
  const modePages: SettingGroupItem[] = Object.keys(workspaces)
    .filter(name => tab.plugin.utils.isMode(name))
    .map(name => buildModePage(name));

  return [
    {
      type: "group",
      heading: "Quick switcher",
      items: [
        {
          name: TOGGLE_TEXT.showInstructions.name,
          desc: TOGGLE_TEXT.showInstructions.desc,
          control: { type: "toggle", key: "showInstructions" },
        },
        {
          name: TOGGLE_TEXT.showDeletePrompt.name,
          desc: TOGGLE_TEXT.showDeletePrompt.desc,
          control: { type: "toggle", key: "showDeletePrompt" },
        },
        {
          name: TOGGLE_TEXT.workspaceSwitcherRibbon.name,
          control: { type: "toggle", key: "workspaceSwitcherRibbon" },
        },
        {
          name: TOGGLE_TEXT.replaceNativeRibbon.name,
          control: { type: "toggle", key: "replaceNativeRibbon" },
        },
        {
          name: TOGGLE_TEXT.modeSwitcherRibbon.name,
          control: { type: "toggle", key: "modeSwitcherRibbon" },
        },
      ],
    },
    {
      type: "group",
      heading: "Workspace enhancements",
      items: [
        {
          // "(beta)" appended here rather than shared -- display() renders the badge as a
          // separate DOM span instead of plain text; see the comment on TOGGLE_TEXT in
          // settings.ts.
          name: "Workspace modes (beta)",
          desc: TOGGLE_TEXT.workspaceSettings.desc,
          control: { type: "toggle", key: "workspaceSettings" },
        },
        {
          name: TOGGLE_TEXT.saveOnChange.name,
          desc: TOGGLE_TEXT.saveOnChange.desc,
          control: { type: "toggle", key: "saveOnChange" },
        },
        {
          name: TOGGLE_TEXT.trackOpenFiles.name,
          desc: TOGGLE_TEXT.trackOpenFiles.desc,
          control: { type: "toggle", key: "trackOpenFiles" },
        },
        {
          name: TOGGLE_TEXT.systemDarkMode.name,
          desc: TOGGLE_TEXT.systemDarkMode.desc,
          control: { type: "toggle", key: "systemDarkMode" },
          visible: () => tab.plugin.settings.workspaceSettings,
        },
        {
          name: TOGGLE_TEXT.reloadLivePreview.name,
          desc: TOGGLE_TEXT.reloadLivePreview.desc,
          control: { type: "toggle", key: "reloadLivePreview" },
          visible: () => tab.plugin.settings.workspaceSettings,
        },
      ],
    },
    { type: "group", heading: "Per workspace", items: workspacePages },
    {
      type: "group",
      heading: "Per mode",
      items: modePages,
      visible: () => tab.plugin.settings.workspaceSettings,
    },
  ];
}

function buildWorkspacePage(
  tab: WorkspacesPlusSettingsTab,
  workspaceName: string,
  workspace: Workspaces
): SettingDefinitionPage {
  // See the matching comment in settings.ts's display() -- leaves without an id can't be
  // targeted by setChildId, so they're skipped rather than rendered as controls that collide
  // on the same key.
  const overrides: SettingGroupItem[] = getChildIds(workspace.main)
    .filter(leaf => leaf.id)
    .map(leaf => ({
      name: leaf.id,
      control: {
        type: "file",
        key: `workspace-override:${encodeURIComponent(workspaceName)}:${encodeURIComponent(leaf.id)}`,
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

function buildModePage(modeName: string): SettingDefinitionPage {
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

function parseOverrideKey(key: string): { workspaceName: string; leafId: string } {
  const rest = key.slice("workspace-override:".length);
  const sepIndex = rest.indexOf(":");
  return {
    workspaceName: decodeURIComponent(rest.slice(0, sepIndex)),
    leafId: decodeURIComponent(rest.slice(sepIndex + 1)),
  };
}

export function getControlValue(tab: WorkspacesPlusSettingsTab, key: string): unknown {
  if (key.startsWith("workspace-description:")) {
    const workspaceName = decodeURIComponent(key.slice("workspace-description:".length));
    return tab.plugin.utils.getWorkspaceSettings(workspaceName)?.description ?? "";
  }
  if (key.startsWith("workspace-override:")) {
    const { workspaceName, leafId } = parseOverrideKey(key);
    return tab.plugin.utils.getWorkspaceSettings(workspaceName)?.fileOverrides?.[leafId] ?? "";
  }
  if (key.startsWith("mode-save-sidebar:")) {
    const modeName = decodeURIComponent(key.slice("mode-save-sidebar:".length));
    return tab.plugin.utils.getModeSettings(modeName)?.saveSidebar ?? false;
  }
  // Only ever invoked by Obsidian itself when getSettingDefinitions() is in play, i.e. on
  // 1.13.0+; display() is the fallback for 1.8.7-1.12.x, where these methods are simply never
  // called. Calling PluginSettingTab's own default implementation directly (rather than via
  // `super`, which is only usable from inside WorkspacesPlusSettingsTab's own class body in
  // settings.ts) keeps this 1.13.0+-only reference contained to this file.
  return PluginSettingTab.prototype.getControlValue.call(tab, key);
}

export function setControlValue(tab: WorkspacesPlusSettingsTab, key: string, value: unknown): void {
  if (key.startsWith("workspace-description:")) {
    const workspaceName = decodeURIComponent(key.slice("workspace-description:".length));
    const settings = tab.plugin.utils.getWorkspaceSettings(workspaceName);
    if (settings) settings.description = value as string;
    tab.plugin.workspacePlugin.saveData();
    return;
  }
  if (key.startsWith("workspace-override:")) {
    const { workspaceName, leafId } = parseOverrideKey(key);
    const settings = tab.plugin.utils.getWorkspaceSettings(workspaceName);
    if (settings) {
      if (!settings.fileOverrides) settings.fileOverrides = {};
      const overrideFile = value as string;
      if (overrideFile) settings.fileOverrides[leafId] = overrideFile;
      else delete settings.fileOverrides[leafId];
    }
    tab.plugin.workspacePlugin.saveData();
    return;
  }
  if (key.startsWith("mode-save-sidebar:")) {
    const modeName = decodeURIComponent(key.slice("mode-save-sidebar:".length));
    const settings = tab.plugin.utils.getModeSettings(modeName);
    if (settings) settings.saveSidebar = value as boolean;
    tab.plugin.workspacePlugin.saveData();
    return;
  }

  void PluginSettingTab.prototype.setControlValue.call(tab, key, value);

  switch (key) {
    case "workspaceSwitcherRibbon":
      tab.plugin.toggleWorkspaceRibbonButton();
      break;
    case "replaceNativeRibbon":
      tab.plugin.toggleNativeWorkspaceRibbon();
      break;
    case "modeSwitcherRibbon":
      tab.plugin.toggleModeRibbonButton();
      break;
    case "workspaceSettings":
      if (value) tab.plugin.enableModesFeature();
      else tab.plugin.disableModesFeature();
      tab.update();
      break;
  }
}
