import { Menu } from "obsidian";
import { WorkspacesPlusPluginWorkspaceModal } from "./workspaceModal";
import WorkspacesPlus from "./main";

// Lightweight alternative to the full switcher modal for triggers that sit in the bottom-left
// corner of the screen (the vault switcher icon, and the ribbon button when its location is
// pinned to the bottom -- see main.ts's updateVaultSwitcherIcon()/updateBottomRibbonWorkspaceButton()):
// the modal opens centered on screen, which is an awkward mouse trip from that corner, so this
// instead pops a native-style Menu at the click location, mirroring Obsidian's own vault-switcher
// dropdown. Lists every real workspace (via Utils.getWorkspaceNames(), shared with the modal's own
// getItems() so the two never disagree about which workspaces are real) with the active one
// checked; a trailing "Manage workspaces..." item opens the full modal for anything the menu
// itself doesn't cover (rename, delete, search, hotkeys, etc.).
export function openWorkspaceMenu(plugin: WorkspacesPlus, evt: MouseEvent): void {
  const menu = new Menu();
  const activeWorkspace = plugin.utils.activeWorkspace;
  plugin.utils.getWorkspaceNames().forEach(workspaceName => {
    menu.addItem(item =>
      item
        .setTitle(workspaceName)
        .setChecked(workspaceName === activeWorkspace)
        .onClick(() => plugin.workspacePlugin.loadWorkspace(workspaceName))
    );
  });
  menu.addSeparator();
  menu.addItem(item =>
    item
      .setTitle("Manage workspaces...")
      .onClick(() => new WorkspacesPlusPluginWorkspaceModal(plugin, plugin.settings, true).open())
  );
  menu.showAtMouseEvent(evt);
}
