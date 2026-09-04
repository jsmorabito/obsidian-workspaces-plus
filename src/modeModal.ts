import { FuzzySuggestModal, WorkspacePluginInstance, FuzzyMatch, Notice, Scope, setIcon, WorkspaceCustomSettings } from "obsidian";
import { createPopper, Instance as PopperInstance } from "@popperjs/core";
import { WorkspacesPlusSettings } from "./settings";
import { createConfirmationDialog } from "./confirm";
import WorkspacesPlus from "./main";

const SETTINGS_ATTR = "workspaces-plus:settings-v1";
export class WorkspacesPlusPluginModeModal extends FuzzySuggestModal<string> {
  workspacePlugin: WorkspacePluginInstance;
  activeWorkspace: string;
  // Only ever created for the status-bar-anchored (non-hotkey, desktop) variant -- see open().
  popper?: PopperInstance;
  settings: WorkspacesPlusSettings;
  showInstructions: boolean = false;
  invokedViaHotkey: boolean;
  emptyStateText: string = "No match found";
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
    this.setPlaceholder("Type mode name...");
    this.buildInstructions();

    // temporary styling to force a transparent modal background to address certain themes
    // that apply a background to the modal container instead of the modal-bg
    this.bgEl.parentElement.addClass("workspaces-plus-transparent-bg-important");

    this.modalEl.classList.add("workspaces-plus-mode-modal");

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
      text: "Save as new mode",
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
  }

  buildInstructions(): void {
    // Touch devices have no modifier-key shortcuts to advertise.
    if (this.app.isMobile) return;
    if (this.settings.showInstructions || this.invokedViaHotkey) {
      let instructions;
      instructions = [
        {
          command: "↵",
          purpose: "load",
        },
        {
          command: "ctrl ↵",
          purpose: "rename",
        },
        {
          command: "shift ⌫",
          purpose: "delete",
        },
        {
          command: "esc",
          purpose: "cancel",
        },
      ];
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
    // be dismissed (escape, background click, or picking an item all silently failed to close it,
    // freezing the UI until Obsidian was force-quit -- see issue #133). It also dropped the
    // now-removed `workspace.pushClosable` call, which threw on every open (see issue #106).
    super.open();
    if (!this.invokedViaHotkey && !this.app.isMobile) {
      // activeDocument, not document -- super.open() just attached the modal under
      // activeWindow's document (for popout-window support), so the popper reference must be
      // looked up in that same document or positioning breaks across windows.
      this.popper = createPopper(
        activeDocument.body.querySelector(".plugin-workspaces-plus.mode-switcher"),
        this.modalEl,
        {
          placement: "top-start",
          modifiers: [{ name: "offset", options: { offset: [0, 10] } }],
        }
      );
    }
  }

  onOpen(): void {
    void super.onOpen();
    this.activeWorkspace = this.workspacePlugin.activeWorkspace;
    let selectedIdx = this.getItems().findIndex(workspace => workspace === this.activeWorkspace);
    this.chooser.setSelectedItem(selectedIdx);
    this.chooser.suggestions[this.chooser.selectedItem]?.scrollIntoViewIfNeeded();
  }

  onClose(): void {
    // Modal.close() already pops this.scope itself before calling onClose() (now that open()
    // properly delegates to super.open(), see above) -- don't pop it a second time here.
    // What close() doesn't know about is the popper open() creates for the status-bar-anchored
    // variant; without destroying it, its window resize/scroll listeners (and the reference to
    // this closed modal's DOM) leak on every picker open.
    this.popper?.destroy();
    this.popper = undefined;
    super.onClose();
  }

  handleRename(targetEl: HTMLElement): void {
    // TODO: Update all workspaces on mode rename
    targetEl.parentElement.parentElement.removeClass("renaming");
    const originalBareName = targetEl.dataset.workspaceName;
    const newBareName = targetEl.textContent?.trim();
    // Bail out if the name is empty or unchanged. Without this guard, an unchanged
    // rename does `workspaces[name] = workspaces[name]` (a no-op) and then
    // `delete workspaces[name]`, wiping the mode. See issue #69.
    if (!newBareName || newBareName === originalBareName) {
      targetEl.textContent = originalBareName;
      targetEl.contentEditable = "false";
      return;
    }
    const originalName = "Mode: " + originalBareName;
    const newName = "Mode: " + newBareName;
    // let settings = this.workspacePlugin.workspaces[this.workspacePlugin.activeWorkspace][SETTINGS_ATTR];
    // let currentMode = settings["mode"] ? settings["mode"] : null;
    for (const workspace of Object.values(this.workspacePlugin.workspaces)) {
      let settings = workspace[SETTINGS_ATTR] as WorkspaceCustomSettings;
      let mode = settings ? settings["mode"] : null;
      if (mode && mode == originalName) {
        (workspace[SETTINGS_ATTR] as WorkspaceCustomSettings)["mode"] = newName;
      }
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
      this.close();
      return false;
    } else if (!this.chooser.values) return false;
    let item = this.chooser.values ? this.chooser.values[this.chooser.selectedItem] : workspaceName;
    return void 0 !== item && (this.selectSuggestion(item as unknown as FuzzyMatch<string>, evt), true);
  };

  saveAndStay(): void {
    let workspaceName = this.inputEl.value ? this.inputEl.value : this.chooser.values[this.chooser.selectedItem].item;
    this.workspacePlugin.saveWorkspace("Mode: " + workspaceName);
    this.chooser.chooser.updateSuggestions();
    new Notice("Successfully saved mode: " + workspaceName);
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
          this.doDelete("Mode: " + workspaceName);
        },
        text: `Do you really want to delete the '` + workspaceName + `' mode?`,
        title: "Mode Delete Confirmation",
      });
    } else {
      this.doDelete("Mode: " + workspaceName);
    }
  }

  renderSuggestion(item: FuzzyMatch<string>, el: HTMLElement): void {
    super.renderSuggestion(item, el);
    const resultEl = document.body.querySelector<HTMLElement>("div.workspaces-plus-mode-modal div.prompt-results");
    const existingEl = resultEl.querySelector<HTMLElement>('div[data-workspace-name="' + el.textContent + '"]');
    let wrapperEl;
    if (existingEl) {
      wrapperEl = existingEl;
    } else {
      wrapperEl = this.wrapSuggestion(el, resultEl);
    }
    this.addDeleteButton(wrapperEl);
    this.addRenameButton(wrapperEl, el);
  }

  wrapSuggestion(childEl: HTMLElement, parentEl: HTMLElement): HTMLElement {
    const wrapperEl = createDiv();
    wrapperEl.addClass("workspace-results");
    childEl.dataset.workspaceName = childEl.textContent;
    childEl.removeClass("suggestion-item");
    childEl.addClass("workspace-item");
    let mode;
    try {
      mode = (
        this.workspacePlugin.workspaces[this.workspacePlugin.activeWorkspace][SETTINGS_ATTR] as WorkspaceCustomSettings
      )["mode"].replace(/^mode: /i, "");
    } catch {
      // property chain may not exist yet, fall back to undefined
    }
    if (childEl.textContent === mode) {
      const activeIcon = wrapperEl.createDiv("active-workspace");
      setIcon(activeIcon, "check");
    }
    wrapperEl.appendChild(childEl);
    parentEl.appendChild(wrapperEl);
    return wrapperEl;
  }

  addRenameButton(wrapperEl: HTMLElement, el: HTMLElement): void {
    const renameIcon = wrapperEl.createDiv("rename-workspace");
    renameIcon.setAttribute("aria-label", "Rename mode");
    renameIcon.setAttribute("aria-label-position", "top");
    setIcon(renameIcon, "pencil");
    renameIcon.addEventListener("click", event => this.onRenameClick(event, el));
  }

  addDeleteButton(wrapperEl: HTMLElement): void {
    const deleteIcon = wrapperEl.createDiv("delete-workspace");
    deleteIcon.setAttribute("aria-label", "Delete mode");
    deleteIcon.setAttribute("aria-label-position", "top");
    setIcon(deleteIcon, "trash-2");
    deleteIcon.addEventListener("click", event => this.deleteWorkspace());
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
    for (const [workspaceName, workspace] of Object.entries(this.workspacePlugin.workspaces)) {
      let settings = workspace[SETTINGS_ATTR] as WorkspaceCustomSettings;
      let mode = settings ? settings["mode"] : null;
      if (mode && mode == workspaceName) {
        (workspace[SETTINGS_ATTR] as WorkspaceCustomSettings)["mode"] = null;
      }
    }
  }

  getItems(): string[] {
    return [
      ...Object.keys(this.workspacePlugin.workspaces)
        .filter(workspace => /^mode:/i.test(workspace))
        .map(workspace => workspace.replace(/mode: /i, ""))
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
      this.close();
    } else this.loadWorkspace("Mode: " + item);
  }

  setWorkspace(workspaceName: string): void {
    this.workspacePlugin.setActiveWorkspace(workspaceName);
  }

  loadWorkspace(workspaceName: string): void {
    this.workspacePlugin.loadWorkspace(workspaceName);
  }
}
