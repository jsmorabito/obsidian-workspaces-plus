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
// Tracks the single open instance of this menu (there's only ever one trigger active at a time)
// so a second click on the same icon closes it instead of reopening -- matching the core vault
// switcher's own toggle behavior. lastHideTime guards the common case: the click's mousedown half
// already dismissed the menu (as an outside click) before this click handler re-fires, so by then
// openMenu is already null and a naive "is one open?" check alone would reopen a fresh one.
let openMenu: Menu | null = null;
let lastHideTime = 0;

export function openWorkspaceMenu(plugin: WorkspacesPlus, evt: MouseEvent): void {
  if (openMenu) {
    openMenu.hide();
    return;
  }
  if (Date.now() - lastHideTime < 200) return;

  const menu = new Menu();
  // Force Obsidian's own HTML-positioned menu instead of the native OS menu (the default when
  // the "Native menus" appearance setting is on). The native path positions via Electron's
  // Menu.popup({x, y, window, frame}), which has shown up mispositioned relative to the click --
  // this menu's trigger buttons sit in corners (vault switcher, bottom ribbon) where that path is
  // the most exposed. Obsidian's own HTML positioning (showAtPosition's non-native branch) is
  // simpler and click-relative, so it isn't subject to the same window/frame coordinate mismatch.
  menu.setUseNativeMenu(false);
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
  menu.onHide(() => {
    openMenu = null;
    lastHideTime = Date.now();
  });
  openMenu = menu;
  menu.showAtMouseEvent(evt);
}
