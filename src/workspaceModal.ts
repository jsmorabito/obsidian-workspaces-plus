import { FuzzySuggestModal, WorkspacePluginInstance, FuzzyMatch, Notice, Scope, setIcon, WorkspaceCustomSettings } from "obsidian";
import { createPopper, Instance as PopperInstance } from "@popperjs/core";
import { WorkspacesPlusSettings } from "./settings";
import { createConfirmationDialog } from "./confirm";
import WorkspacesPlus from "./main";

const SETTINGS_ATTR = "workspaces-plus:settings-v1";
export class WorkspacesPlusPluginWorkspaceModal extends FuzzySuggestModal<string> {
  workspacePlugin: WorkspacePluginInstance;
  activeWorkspace: string;
  popper: PopperInstance;
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
    this.app.keymap.pushScope(this.scope);
    document.body.appendChild(this.containerEl);
    if (!this.invokedViaHotkey && !this.app.isMobile) {
      this.popper = createPopper(document.body.querySelector(".plugin-workspaces-plus"), this.modalEl, {
        placement: "top-start",
        modifiers: [{ name: "offset", options: { offset: [0, 10] } }],
      });
    }
    this.onOpen();
    this.app.workspace.pushClosable(this);
  }

  onOpen(): void {
    void super.onOpen();
    this.activeWorkspace = this.workspacePlugin.activeWorkspace;
    let selectedIdx = this.getItems().findIndex(workspace => workspace === this.activeWorkspace);
    this.chooser.setSelectedItem(selectedIdx);
    this.chooser.suggestions[this.chooser.selectedItem]?.scrollIntoViewIfNeeded();
  }

  onClose(): void {
    this.app.keymap.popScope(this.scope);
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
    const existingEl = resultEl.querySelector<HTMLElement>('div[data-workspace-name="' + workspaceName + '"]');
    let wrapperEl;
    if (existingEl) {
      wrapperEl = existingEl;
    } else {
      wrapperEl = this.wrapSuggestion(el, resultEl);
    }
    let isMobile;
    try {
      isMobile = this.workspacePlugin.workspaces[workspaceName].left.type == "mobile-drawer";
    } catch {
      // property chain may not exist yet, fall back to undefined
    }
    this.addDeleteButton(wrapperEl, workspaceName);
    this.addRenameButton(wrapperEl, el);
    this.addPlatformButton(wrapperEl, isMobile ? "mobile" : "desktop");
    this.addDescription(wrapperEl, workspaceName);
  }

  wrapSuggestion(childEl: HTMLElement, parentEl: HTMLElement): HTMLElement {
    const wrapperEl = createDiv();
    wrapperEl.addClass("workspace-results");
    childEl.dataset.workspaceName = childEl.textContent;
    childEl.removeClass("suggestion-item");
    childEl.addClass("workspace-item");
    childEl.addClass("workspace-name");
    if (childEl.textContent === this.workspacePlugin.activeWorkspace) {
      const activeIcon = wrapperEl.createDiv("active-workspace");
      setIcon(activeIcon, "check");
    }
    wrapperEl.appendChild(childEl);
    parentEl.appendChild(wrapperEl);
    // wrapperEl.appendChild(descEl);
    return wrapperEl;
  }

  addRenameButton(wrapperEl: HTMLElement, el: HTMLElement): void {
    const renameIcon = wrapperEl.createDiv("rename-workspace");
    renameIcon.setAttribute("aria-label", "Rename workspace");
    renameIcon.setAttribute("aria-label-position", "top");
    setIcon(renameIcon, "pencil");
    renameIcon.addEventListener("click", event => this.onRenameClick(event, el));
  }

  addDeleteButton(wrapperEl: HTMLElement, workspaceName: string): void {
    const deleteIcon = wrapperEl.createDiv("delete-workspace");
    deleteIcon.setAttribute("aria-label", "Delete workspace");
    deleteIcon.setAttribute("aria-label-position", "top");
    setIcon(deleteIcon, "trash-2");
    deleteIcon.addEventListener("click", event => this.deleteWorkspace(workspaceName));
  }

  addDescription(wrapperEl: HTMLElement, workspaceName: string): void {
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

  addPlatformButton(wrapperEl: HTMLElement, platform: string): void {
    const renameIcon = wrapperEl.createDiv("platform");
    if (platform == "mobile") {
      renameIcon.setAttribute("aria-label", "Mobile workspace");
      setIcon(renameIcon, "smartphone");
    } else {
      renameIcon.setAttribute("aria-label", "Desktop workspace");
      setIcon(renameIcon, "monitor");
    }
    renameIcon.setAttribute("aria-label-position", "top");
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
