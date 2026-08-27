# Workspaces Plus

![Artboard-2-3](https://user-images.githubusercontent.com/46250921/133352216-e0a2c9b6-070b-46f7-9a6f-d3a18f0c69b1.png)

Workspaces Plus is a plugin that expands the functionality of [workspaces](https://help.obsidian.md/Plugins/Workspaces) in [Obsidian](https://obsidian.md/).

> [!WARNING]
> Obsidian's core workspace plugin must be activated for Workspaces Plus to work properly

## Features

### Workspace Indicator

- current active workspace shown in status bar
- click on workspace name in status bar to open workspace picker menu
- `shift-click` status bar icon or workspace name to save the workspace
<img src="https://user-images.githubusercontent.com/46250921/133325073-af2d58ec-e8a1-48fb-a48c-792b348235fd.png" width="350">

### Workspace Picker

- switch, delete, rename, and create new workspaces
<img src="https://user-images.githubusercontent.com/46250921/133325287-94a36543-f0ee-4956-9ad5-91c572e5b3c4.png" width="350">

### Workspace Switcher modal

- open with assignable hotkey
- switch, delete, rename, and create new workspaces
<img src="https://user-images.githubusercontent.com/46250921/133325396-bc429aa5-696f-4e44-8e78-4a9bd504867e.png" width="400">

### Hotkeys

- open Workspaces Plus switcher modal
- open specific workspace by name
- cycle to the next workspace
- save the current workspace and cycle to the next workspace

### Plugin Options

- Toggle keyboard shortcuts on/off for Workspace Picker
- Toggle workspace delete confirmation on/off
- Set default workspace switch behavior to always save when switching

### Theming Options

- Workspaces Plus adds a data attribute to the HTML document body which can be used to set workspace specific styling
  - The data attribute is body[data-workspace-name="My Workspace"]
  - The attribute will be updated upon the loading of any new workspace

### Workspace Overrides

- Ability to override pages in a workspace using the templates variables.

## How to use

After enabling the plugin from the settings menu, you will see that a workspace icon has been added to the status bar in the lower right corner of the interface. If you are already using workspaces in Obsidian, you will notice that the name of your current active workspace is located next to the that icon.

> [!WARNING]
> Obsidian's core workspace plugin must be activated for Workspaces Plus to work properly

### Creating a Workspace

You can create a workspace through either the Workspace Picker or the Workspace Switcher modal with the same workflow

1. Type your new workspace name into the input field
2. Use `shift-enter` to create the new workspace

### Renaming a Workspace

Rename workspaces from the picker or modal by clicking on the pencil icon next to the workspace name

### Deleting a Workspace

Workspaces can be deleted by either using the trach can icon next to the workspaces name or pressing the shortcut `shift-delete` while the workspace is selected in the menu

### Opening a Workspace

1. Open the Workspace Switcher via hotkey or click on the workspace icon or name in status bar to open the Workspace Picker
2. You can open a workspace by clicking on it with your mouse or by pressing enter after navigating to it with the up/down arrows on your keyboard

### Saving Workspaces

- By default, workspaces are not automatically saved when switched
- You can save a workspace with `shift-click` on the workspace icon or name in the status bar
- From either switcher menu you can use `shift-enter` to save your current active workspace or `alt-enter` to save your current active workspace and switch to the new one you have selected
- In the Plugin Options menu (located in Obsidians settings) you can toggle on a setting which will automatically save the active workspace on switch

### Overriding a page in a Workspace

- In settings scroll to the bottom and open the workspace you want to modify.
- In the text box next to the page ID enter the string to load with template variables
  - Example: 1 Journal/{{date:YYYY}}/{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}.md
- Switch to the workspace and the page will be loaded with the value from the override with the variables replaced.

### Mobile

Workspaces Plus runs on mobile (phone and tablet). A few differences from desktop:

- Obsidian hides the status bar on mobile, so the workspace indicator lives elsewhere: the **sidebar ribbon icon** is enabled by default on mobile, and the **Open workspace switcher** command is always available. The ribbon toggle in settings still lets you turn the icon off.
- The switcher and picker show their rename / delete / platform actions inline (no hover needed) with larger touch targets.
- **Workspace Modes is desktop only.** Modes snapshot and restore Obsidian's core configuration, which is shared with mobile, so applying them on a phone or tablet would overwrite mobile-specific settings. Plain workspace switching, renaming, saving, overrides, and file tracking all work normally on mobile.

## Extra

<details>
  <summary>Compact Workspace Picker CSS Snippet</summary>
  
![image](https://user-images.githubusercontent.com/46250921/135287222-ada674cf-e8e9-4bbf-9d99-07c9892b8e76.png)

  ```css
.workspaces-plus-modal.quick-switch {
  padding: 0px;
  border-radius: 5px;
  min-width: 13em;
}

.workspaces-plus-moda.quick-switch .workspace-item {
  padding-left: 2em;
  padding-right: 4em;
  font-size: 0.9em;
}

.workspaces-plus-modal.quick-switch .prompt-results {
  padding-top: 0;
}

.workspaces-plus-modal.quick-switch .prompt-results::-webkit-scrollbar {
  display: none;
}

.workspaces-plus-modal.quick-switch .workspace-results {
  padding: 0px;
}

.workspaces-plus-modal.quick-switch .workspace-item.is-selected {
  border-radius: 0px !important;
}

.workspaces-plus-modal.quick-switch input.prompt-input {
  font-size: 0.9em;
  padding: 0px 1em;
  border-top-left-radius: 5px !important;
  border-top-right-radius: 5px !important;
  border-radius: 0px;
  border: none !important;
  border-bottom: 1px solid var(--background-modifier-border) !important;
}

.workspaces-plus-modal.quick-switch input.prompt-input:focus {
  box-shadow: none;
  border: none !important;
  border-bottom: 1px solid var(--background-modifier-border) !important;
}

.workspaces-plus-modal.quick-switch .delete-workspace {
  right: 0.7em !important;
}

.workspaces-plus-modal.quick-switch .rename-workspace {
  right: 2em !important;
}
```

</details>

## Installation

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-workspaces-plus/`.
- via Obsidian Community Plugins browser

## Feedback

Share feedback, issues, and ideas on [github](https://github.com/nothingislost/obsidian-workspaces-plus/issues), with our [Workspaces Plus feedback survey](https://airtable.com/shrETC7GS1MOYSTAI), or tag the authors on Discord!

## Credits

- This plugin is being developed by [Johnny ✨](https://github.com/jsmorabito) and [Nothingislost](https://github.com/nothingislost)
- Workspace Picker and Modal based off of [Obsidian Theme Picker](https://github.com/kenset/obsidian-theme-picker) by [Kenset](https://github.com/kenset)

## Changelog

- 0.4.17 - Beta
  - Fix issue with workspaces using tabs so they are parsed correctly for overrides.
  - Added details on how to use overrides to template files and paths.

- 0.3.1
  - Fix bug in workspace rename logic which was preventing hotkey reassignment

- 0.3.0
  - Add hotkey support for loading specific workspaces
    - This feature will create a command for every workspace in your vault, which can then be bound to hotkeys
    - This feature supports renaming workspaces while maintaining the associated hotkey
    - You can add these workspace load commands to cMenu and workspace renames will automatically update the cMenu button as well
  - Add a data attribute to the body of the HTML document which indicates the currently active workspace name.
    - The selector looks like this: body[data-workspace-name="My Workspace"]
