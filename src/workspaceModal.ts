import {
  FuzzySuggestModal,
  WorkspacePluginInstance,
  FuzzyMatch,
  Notice,
  Scope,
  setIcon,
  WorkspaceCustomSettings,
  Hotkey,
  Modifier,
  Platform,
} from "obsidian";
import { createPopper, Instance as PopperInstance } from "@popperjs/core";
import { WorkspacesPlusSettings } from "./settings";
import { createConfirmationDialog } from "./confirm";
import WorkspacesPlus from "./main";

const SETTINGS_ATTR = "workspaces-plus:settings-v1";

// [mac symbol, other-platform label] for each modifier, matching how Obsidian's own hotkey UI
// distinguishes platforms (symbols on mac, words elsewhere).
const MODIFIER_LABELS: Record<Modifier, [string, string]> = {
  Mod: ["⌘", "Ctrl"],
  Ctrl: ["⌃", "Ctrl"],
  Meta: ["⌘", "Win"],
  Alt: ["⌥", "Alt"],
  Shift: ["⇧", "Shift"],
};

function formatHotkey(hotkey: Hotkey): string {
  const platformIdx = Platform.isMacOS ? 0 : 1;
  const modifiers = hotkey.modifiers.map(modifier => MODIFIER_LABELS[modifier][platformIdx]);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return [...modifiers, key].join(" ");
}

export class WorkspacesPlusPluginWorkspaceModal extends FuzzySuggestModal<string> {
  workspacePlugin: WorkspacePluginInstance;
  activeWorkspace: string;
  // Only ever created for the status-bar-anchored (non-hotkey, desktop) variant -- see open().
  popper?: PopperInstance;
  settings: WorkspacesPlusSettings;
  showInstructions: boolean = false;
  invokedViaHotkey: boolean;
  emptyStateText: string = "No match found.";
  bgEl: HTMLElement;
  plugin: WorkspacesPlus;

  constructor(plugin: WorkspacesPlus, settings: WorkspacesPlusSettings, hotkey: boolean = false) {
    super(plugin.app);
    this.app = plugin.app;
    this.plugin = plugin;

    // standard initialization
    this.settings = settings;
    this.invokedViaHotkey = hotkey;
    this.workspacePlugin = this.app.internalPlugins.getPluginById("workspaces").instance as WorkspacePluginInstance;
    this.setPlaceholder("Type workspace name...");
    this.buildInstructions();

    // temporary styling to force a transparent modal background to address certain themes
    // that apply a background to the modal container instead of the modal-bg
    this.bgEl.parentElement.addClass("workspaces-plus-transparent-bg-important");

    this.modalEl.classList.add("workspaces-plus-modal");

    // handle custom modal positioning when invoked via the status bar (desktop only --
    // the status bar is hidden on mobile, so there is no anchor to position against)
    if (!this.invokedViaHotkey && !this.app.isMobile) {
      this.bgEl.addClass("workspaces-plus-transparent-bg");
      this.modalEl.classList.add("quick-switch");
    }

    // setup key bindings
    this.scope = new Scope();
    this.setupScope.apply(this);

    // setup event listeners
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Function.prototype.bind's TS overloads fall back to `any` for methods with more than a few params; this is a correctly-bound reference to a real prototype method
    this.modalEl.on("input", ".prompt-input", this.onInputChanged.bind(this));
    this.modalEl.on("click", ".workspace-item", this.onSuggestionClick);
    this.modalEl.on("mousemove", ".workspace-item", this.onSuggestionMouseover);

    // clone the input element as a hacky way to get rid of the obsidian onInput handler
    // const inputElClone = this.inputEl.cloneNode() as HTMLInputElement;
    // this.modalEl.replaceChild(inputElClone, this.inputEl);
    // this.inputEl = inputElClone;
  }

  onNoSuggestion(): void {
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(this.emptyStateText);
    const el = this.chooser.containerEl.querySelector(".suggestion-empty");
    el.createEl("button", {
      cls: "list-item-part",
      text: "Save as new workspace",
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Function.prototype.bind's TS overloads fall back to `any` for methods with more than a few params; this is a correctly-bound reference to a real prototype method
    }).addEventListener("click", this.saveAndStay.bind(this));
  }

  setupScope(): void {
    this.scope.register([], "Escape", evt => this.onEscape(evt));
    this.scope.register([], "Enter", evt => this.useSelectedItem(evt));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Function.prototype.bind's TS overloads fall back to `any` for methods with more than a few params; this is a correctly-bound reference to a real prototype method
    this.scope.register(["Shift"], "Delete", this.deleteWorkspace.bind(this));
    this.scope.register(["Ctrl"], "Enter", evt => this.onRenameClick(evt, null));
    this.scope.register(["Shift"], "Enter", evt => this.useSelectedItem(evt));
    this.scope.register(["Alt"], "Enter", evt => this.useSelectedItem(evt));
    this.scope.register([], "ArrowUp", evt => {
      if (!evt.isComposing) return this.chooser.setSelectedItem(this.chooser.selectedItem - 1, true), false;
    });
    this.scope.register([], "ArrowDown", evt => {
      if (!evt.isComposing) return this.chooser.setSelectedItem(this.chooser.selectedItem + 1, true), false;
    });
    this.scope.register(["Ctrl"], ",", () => this.openWorkspaceSettings());
    // Linear-style quick switch: bare number keys jump to the nth visible workspace. Only
    // registered in "number" badge mode -- otherwise digits behave as normal search input, and a
    // workspace's own custom hotkey (registered globally via Obsidian's command/hotkey system,
    // independent of this modal's Scope) remains the only way to jump to it by keyboard.
    if (this.settings.workspaceBadges === "number") {
      for (let i = 1; i <= 9; i++) {
        this.scope.register([], String(i), evt => this.quickSwitchToIndex(i - 1, evt));
      }
    }
  }

  quickSwitchToIndex = (index: number, evt: KeyboardEvent): boolean | void => {
    // Only takes over 1-9 when the search box is empty -- with a query typed, digits need to work
    // as ordinary filter characters (e.g. a workspace name containing a number). Renaming uses a
    // contenteditable div, not the prompt input, so also let digits type normally there.
    if (this.inputEl.value || (evt.target as HTMLElement)?.isContentEditable) return;
    // Looked up the same way as the badge numbers themselves (see refreshNumberBadges) -- both
    // need the row that's actually on screen at this position, which chooser.values/suggestions
    // don't reliably track (see the badge-positioning fix for why).
    const resultEl = document.body.querySelector<HTMLElement>("div.workspaces-plus-modal div.prompt-results");
    const wrapperEl = resultEl?.querySelectorAll<HTMLElement>(":scope > .workspace-results")[index];
    const workspaceName = wrapperEl?.dataset.workspaceName;
    if (!workspaceName) return;
    this.loadWorkspace(workspaceName);
    this.close();
    return false;
  };

  // Points at this plugin's own settings tab (per-workspace description, file overrides, etc.)
  // rather than cluttering the switcher itself with per-row detail -- one keystroke away instead
  // of having to hunt for it via Community plugins > Workspaces Plus.
  openWorkspaceSettings(): boolean {
    this.close();
    this.app.setting.open();
    this.app.setting.openTabById(this.plugin.manifest.id);
    return false;
  }

  buildInstructions(): void {
    // Touch devices have no modifier-key shortcuts to advertise.
    if (this.app.isMobile) return;
    if (this.settings.showInstructions || this.invokedViaHotkey) {
      let instructions;
      if (!this.settings.saveOnChange) {
        instructions = [
          {
            command: "shift ↵",
            purpose: "save",
          },
          {
            command: "alt ↵",
            purpose: "save and switch",
          },
        ];
      } else {
        instructions = [
          {
            command: "↵",
            purpose: "switch",
          },
        ];
      }
      if (this.settings.workspaceBadges === "number") {
        instructions.push({
          command: "1-9",
          purpose: "quick switch",
        });
      }
      instructions.push(
        {
          command: "ctrl ↵",
          purpose: "rename",
        },
        {
          command: "shift ⌫",
          purpose: "delete",
        },
        {
          command: "ctrl ,",
          purpose: "workspace settings",
        },
        {
          command: "esc",
          purpose: "cancel",
        }
      );
      this.setInstructions(instructions);
    }
  }

  onInputChanged(): void {
    this.chooser.chooser.updateSuggestions();
  }

  onEscape(evt: MouseEvent | KeyboardEvent): void {
    const evtTargetEl = evt.target as HTMLElement;
    // if we're actively renaming a workspace, escape out of the rename
    if (evtTargetEl.classList.contains("workspace-item") && evtTargetEl.contentEditable === "true") {
      evtTargetEl.textContent = evtTargetEl.dataset.workspaceName;
      evtTargetEl.contentEditable = "false";
      return;
    }
    // otherwise, close the modal
    this.close();
  }

  onSuggestionClick = (evt: MouseEvent | KeyboardEvent, itemEl: HTMLElement) => {
    if (itemEl.contentEditable === "true") {
      // allow cursor selection in rename mode by ignoring the click
      evt.stopPropagation();
      return;
    }
    evt.preventDefault();
    let item = this.chooser.suggestions.indexOf(itemEl as HTMLElement & { scrollIntoViewIfNeeded: () => void });
    this.chooser.setSelectedItem(item);
    this.useSelectedItem(evt);
  };

  onSuggestionMouseover = (evt: MouseEvent | KeyboardEvent, itemEl: HTMLElement) => {
    let item = this.chooser.suggestions.indexOf(itemEl as HTMLElement & { scrollIntoViewIfNeeded: () => void });
    this.chooser.setSelectedItem(item);
  };

  open(): void {
    // Delegate to Modal's own open() instead of reimplementing it by hand. Besides pushing the
    // keymap scope and calling onOpen(), it also flips Modal's internal isOpen flag and registers
    // the modal on Obsidian's own modal stack -- the hand-rolled version below (removed) skipped
    // both. As of Obsidian 1.14.0, close() no-ops unless isOpen was set, so the modal could never
    // be dismissed (escape, background click, or picking a workspace all silently failed to close
    // it, freezing the UI until Obsidian was force-quit -- see issue #133). It also dropped the
    // now-removed `workspace.pushClosable` call, which threw on every open (see issue #106).
    super.open();
    if (!this.invokedViaHotkey && !this.app.isMobile) {
      // activeDocument, not document -- super.open() just attached the modal under
      // activeWindow's document (for popout-window support), so the popper reference must be
      // looked up in that same document or positioning breaks across windows.
      this.popper = createPopper(activeDocument.body.querySelector(".plugin-workspaces-plus"), this.modalEl, {
        placement: "top-start",
        modifiers: [{ name: "offset", options: { offset: [0, 10] } }],
      });
    }
  }

  onOpen(): void {
    void super.onOpen();
    this.activeWorkspace = this.workspacePlugin.activeWorkspace;
    let selectedIdx = this.getItems().findIndex(workspace => workspace === this.activeWorkspace);
    this.chooser.setSelectedItem(selectedIdx);
    this.chooser.suggestions[this.chooser.selectedItem]?.scrollIntoViewIfNeeded();
    this.watchNumberBadges();
  }

  // Obsidian's own suggestion rendering doesn't finish inserting every row into the DOM
  // synchronously -- calling refreshNumberBadges() right after onOpen()/onInputChanged() could run
  // before some rows existed yet, so it numbered whatever had landed so far instead of the full
  // list (e.g. a single row present at that instant getting numbered "1" regardless of its real
  // position). Watching resultEl directly sidesteps guessing at that timing: whenever rows are
  // actually added or removed, this re-numbers from what's really in the DOM at that moment.
  numberBadgeObserver?: MutationObserver;

  watchNumberBadges(): void {
    this.numberBadgeObserver?.disconnect();
    this.numberBadgeObserver = undefined;
    if (this.settings.workspaceBadges !== "number") return;
    const resultEl = document.body.querySelector<HTMLElement>("div.workspaces-plus-modal div.prompt-results");
    if (!resultEl) return;
    this.refreshNumberBadges(resultEl);
    this.numberBadgeObserver = new MutationObserver(() => this.refreshNumberBadges(resultEl));
    this.numberBadgeObserver.observe(resultEl, { childList: true });
  }

  // Walks resultEl's own direct children -- the .workspace-results wrappers this plugin creates
  // and controls itself -- instead of Obsidian's own chooser.suggestions/values bookkeeping, which
  // doesn't reliably correspond to this plugin's DOM (rows can get rendered more than once across
  // a modal's lifetime, e.g. re-filtering).
  refreshNumberBadges(resultEl: HTMLElement): void {
    Array.from(resultEl.querySelectorAll<HTMLElement>(":scope > .workspace-results")).forEach((wrapperEl, index) => {
      const rowEndEl = this.getRowEndEl(wrapperEl);
      rowEndEl.querySelector(".workspace-badge")?.remove();
      if (index >= 9) return;
      const badgeEl = rowEndEl.createDiv("workspace-badge");
      badgeEl.textContent = String(index + 1);
    });
  }

  // The checkmark and badge live together in one flex row, right-aligned and vertically centered
  // on the item -- Linear-style, checkmark then badge -- rather than each independently
  // absolutely-positioned (the checkmark used to sit at the opposite end of the row from the
  // badge, and a fixed top offset on the badge alone put it wherever the row happened to be
  // tallest, e.g. below a description, instead of centered on the row).
  getRowEndEl(wrapperEl: HTMLElement): HTMLElement {
    return wrapperEl.querySelector<HTMLElement>(":scope > .workspace-row-end") ?? wrapperEl.createDiv("workspace-row-end");
  }

  onClose(): void {
    // Modal.close() already pops this.scope itself before calling onClose() (now that open()
    // properly delegates to super.open(), see above) -- don't pop it a second time here.
    // What close() doesn't know about is the popper open() creates for the status-bar-anchored
    // variant; without destroying it, its window resize/scroll listeners (and the reference to
    // this closed modal's DOM) leak on every picker open.
    this.popper?.destroy();
    this.popper = undefined;
    this.numberBadgeObserver?.disconnect();
    this.numberBadgeObserver = undefined;
    super.onClose();
  }

  handleRename(targetEl: HTMLElement): void {
    targetEl.parentElement.parentElement.removeClass("renaming");
    const originalName = targetEl.dataset.workspaceName;
    const newName = targetEl.textContent?.trim();
    // Bail out if the name is empty or unchanged. Without this guard, an unchanged
    // rename does `workspaces[name] = workspaces[name]` (a no-op) and then
    // `delete workspaces[name]`, wiping the workspace. See issue #69.
    if (!newName || newName === originalName) {
      targetEl.textContent = originalName;
      targetEl.contentEditable = "false";
      return;
    }
    this.workspacePlugin.workspaces[newName] = this.workspacePlugin.workspaces[originalName];
    delete this.workspacePlugin.workspaces[originalName];
    if (originalName === this.activeWorkspace) {
      this.setWorkspace(newName);
      this.activeWorkspace = newName;
    }
    this.chooser.chooser.updateSuggestions();
    targetEl.contentEditable = "false";
    let selectedIdx = this.getItems().findIndex((workspace: string) => workspace === newName);
    this.chooser.setSelectedItem(selectedIdx, true);
    this.app.workspace.trigger("workspace-rename", newName, originalName);
  }

  useSelectedItem = (evt: MouseEvent | KeyboardEvent) => {
    const targetEl = evt.composedPath()[0] as HTMLElement;
    if (targetEl.contentEditable === "true") {
      this.handleRename(targetEl);
      return;
    }
    let workspaceName = this.inputEl.value ? this.inputEl.value : this.chooser.values[this.chooser.selectedItem].item;
    if (workspaceName && evt.shiftKey) {
      this.saveAndStay();
      // if (!/^mode:/i.test(workspaceName)) this.setWorkspace(workspaceName);
      // this.close();
      return false;
    } else if (!this.chooser.values) return false;
    let item = this.chooser.values ? this.chooser.values[this.chooser.selectedItem] : workspaceName;
    return void 0 !== item && (this.selectSuggestion(item as unknown as FuzzyMatch<string>, evt), true);
  };

  saveAndStay(): void {
    let workspaceName = this.inputEl.value ? this.inputEl.value : this.chooser.values[this.chooser.selectedItem].item;
    this.workspacePlugin.saveWorkspace(workspaceName);
    this.chooser.chooser.updateSuggestions();
    if (!/^mode:/i.test(workspaceName)) this.setWorkspace(workspaceName);
    new Notice("Successfully saved workspace: " + workspaceName);
    this.close();
  }

  saveAndSwitch(): void {
    this.workspacePlugin.saveWorkspace(this.activeWorkspace);
    this.plugin.registerWorkspaceHotkeys();
    new Notice("Successfully saved workspace: " + this.activeWorkspace);
  }

  deleteWorkspace(workspaceName: string = null): void {
    if (!workspaceName) {
      let currentSelection = this.chooser.selectedItem;
      workspaceName = this.chooser.values[currentSelection].item;
    }
    if (this.settings.showDeletePrompt) {
      createConfirmationDialog(this.app, {
        cta: "Delete",
        onAccept: async () => {
          this.doDelete(workspaceName);
        },
        text: `Do you really want to delete the '` + workspaceName + `' workspace?`,
        title: "Workspace Delete Confirmation",
      });
    } else {
      this.doDelete(workspaceName);
    }
  }

  renderSuggestion(item: FuzzyMatch<string>, el: HTMLElement): void {
    super.renderSuggestion(item, el);
    const workspaceName = el.textContent;
    const resultEl = document.body.querySelector<HTMLElement>("div.workspaces-plus-modal div.prompt-results");
    // Must match .workspace-results (the outer row wrapper), not the inner .workspace-item text
    // div -- both used to carry the same data-workspace-name attribute, so this query matched the
    // inner div instead, and treating that as the row's wrapper corrupted the row's structure
    // (descriptions/badges nested one level too deep instead of alongside the name) whenever a row
    // got re-rendered a second time, which threw off position-based numbering for other rows too.
    const existingEl = resultEl.querySelector<HTMLElement>('.workspace-results[data-workspace-name="' + workspaceName + '"]');
    const wrapperEl = existingEl ?? this.wrapSuggestion(el, resultEl);
    this.addDescription(wrapperEl, workspaceName);
    this.addBadge(wrapperEl, workspaceName);
  }

  // Replaces the old hover-revealed rename/delete/platform icon row -- those are still reachable
  // by keyboard (ctrl ↵ rename, shift ⌫ delete; see the instructions bar) or from this plugin's
  // own settings tab (ctrl ,), so this slot is free to show what's actually useful to see at a
  // glance: the workspace's assigned hotkey. (The "number" badge mode is handled separately, in
  // refreshNumberBadges() -- it needs each row's position in the fully-rendered list, which isn't
  // available yet at this point; see the comment there.)
  addBadge(wrapperEl: HTMLElement, workspaceName: string): void {
    if (this.settings.workspaceBadges === "number") return;
    const hotkeys = this.plugin.app.hotkeyManager.getHotkeys(`${this.plugin.manifest.id}:${workspaceName}`);
    if (!hotkeys?.length) return;
    const badgeEl = this.getRowEndEl(wrapperEl).createDiv("workspace-badge");
    badgeEl.textContent = formatHotkey(hotkeys[0]);
  }

  wrapSuggestion(childEl: HTMLElement, parentEl: HTMLElement): HTMLElement {
    const wrapperEl = createDiv();
    wrapperEl.addClass("workspace-results");
    wrapperEl.dataset.workspaceName = childEl.textContent;
    childEl.dataset.workspaceName = childEl.textContent;
    childEl.removeClass("suggestion-item");
    childEl.addClass("workspace-item");
    childEl.addClass("workspace-name");
    // childEl appended before the row-end cluster is created -- .workspace-item has its own
    // position: relative (needed for the rename text cursor), so when it's .is-selected and gets
    // an opaque background, CSS paints later-DOM-order positioned siblings on top of earlier ones.
    // Creating the row-end cluster (checkmark, badge) after childEl keeps it painting on top of
    // the selected-row background instead of getting hidden underneath it.
    wrapperEl.appendChild(childEl);
    if (childEl.textContent === this.workspacePlugin.activeWorkspace) {
      // Appended first within the cluster so it lands to the left of the badge -- see getRowEndEl().
      const activeIcon = this.getRowEndEl(wrapperEl).createDiv("active-workspace");
      setIcon(activeIcon, "check");
    }
    parentEl.appendChild(wrapperEl);
    // wrapperEl.appendChild(descEl);
    return wrapperEl;
  }

  addDescription(wrapperEl: HTMLElement, workspaceName: string): void {
    if (!this.settings.showWorkspaceDescriptions) return;
    let description;
    try {
      description = (this.workspacePlugin.workspaces[workspaceName][SETTINGS_ATTR] as WorkspaceCustomSettings)[
        "description"
      ];
    } catch {
      // property chain may not exist yet, fall back to undefined
    }
    if (description) {
      const descEl = wrapperEl.createDiv("workspace-description");
      descEl.textContent = description;
    }
  }

  onRenameClick = (evt: MouseEvent | KeyboardEvent, el: HTMLElement): void => {
    evt.stopPropagation();
    if (!el) el = this.chooser.suggestions[this.chooser.selectedItem];
    el.parentElement.parentElement.addClass("renaming");
    if (el.contentEditable === "true") {
      el.textContent = el.dataset.workspaceName;
      el.contentEditable = "false";
      return;
    } else {
      el.contentEditable = "true";
    }
    const selection = window.getSelection();
    const range = document.createRange();
    selection.removeAllRanges();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.addRange(range);
    el.focus();
    el.onblur = ev => {
      el.parentElement.parentElement.removeClass("renaming");
      el.contentEditable = "false";
    };
  };

  doDelete(workspaceName: string): void {
    let currentSelection = this.chooser.selectedItem;
    this.workspacePlugin.deleteWorkspace(workspaceName);
    this.chooser.chooser.updateSuggestions();
    this.chooser.setSelectedItem(currentSelection - 1, true);
    this.plugin.onWorkspaceDelete(workspaceName);
  }

  getItems(): string[] {
    return [
      ...Object.keys(this.workspacePlugin.workspaces)
        .filter(workspace => !/^mode:/i.test(workspace))
        .sort(),
    ];
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
    let modifiers: string;
    if (evt.shiftKey && !evt.altKey) modifiers = "Shift";
    else if (evt.altKey && !evt.shiftKey) modifiers = "Alt";
    else modifiers = "";
    if (modifiers === "Shift") {
      this.saveAndStay();
      this.setWorkspace(item);
      this.close();
    } else if (modifiers === "Alt") {
      this.saveAndSwitch();
      this.loadWorkspace(item);
    } else this.loadWorkspace(item);
  }

  setWorkspace(workspaceName: string): void {
    this.workspacePlugin.setActiveWorkspace(workspaceName);
  }

  loadWorkspace(workspaceName: string): void {
    this.workspacePlugin.loadWorkspace(workspaceName);
  }
}
