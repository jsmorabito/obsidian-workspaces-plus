import { FuzzySuggestModal, WorkspacePluginInstance, FuzzyMatch, Notice, Scope } from "obsidian";
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

    // handle custom modal positioning when invoked via the status bar
    if (!this.invokedViaHotkey) {
      this.bgEl.addClass("workspaces-plus-transparent-bg");
      this.modalEl.classList.add("quick-switch");
    }

    // setup key bindings
    this.scope = new Scope();
    this.setupScope.apply(this);

    // setup event listeners
    this.modalEl.on("input", ".prompt-input", this.onInputChanged.bind(this));
    this.modalEl.on("click", ".workspace-item", this.onSuggestionClick.bind(this));
    this.modalEl.on("mousemove", ".workspace-item", this.onSuggestionMouseover.bind(this));

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
    }).addEventListener("click", this.saveAndStay.bind(this));
  }

  setupScope(): void {
    this.scope.register([], "Escape", evt => this.onEscape(evt));
    this.scope.register([], "Enter", evt => this.useSelectedItem(evt));
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

  onSuggestionClick = function (evt: MouseEvent | KeyboardEvent, itemEl: HTMLElement) {
    if (itemEl.contentEditable === "true") {
      // allow cursor selection in rename mode by ignoring the click
      evt.stopPropagation();
      return;
    }
    evt.preventDefault();
    let item = this.chooser.suggestions.indexOf(itemEl);
    this.chooser.setSelectedItem(item);
    this.useSelectedItem(evt);
  };

  onSuggestionMouseover = function (evt: MouseEvent | KeyboardEvent, itemEl: HTMLElement) {
    let item = this.chooser.suggestions.indexOf(itemEl);
    this.chooser.setSelectedItem(item);
  };

  open(): void {
    (<any>this.app).keymap.pushScope(this.scope);
    document.body.appendChild(this.containerEl);
    if (!this.invokedViaHotkey) {
      this.popper = createPopper(document.body.querySelector(".plugin-workspaces-plus"), this.modalEl, {
        placement: "top-start",
        modifiers: [{ name: "offset", options: { offset: [0, 10] } }],
      });
    }
    this.onOpen();
    (this.app.workspace as any).pushClosable(this);
  }

  onOpen(): void {
    void super.onOpen();
    this.activeWorkspace = this.workspacePlugin.activeWorkspace;
    let selectedIdx = this.getItems().findIndex(workspace => workspace === this.activeWorkspace);
    this.chooser.setSelectedItem(selectedIdx);
    this.chooser.suggestions[this.chooser.selectedItem]?.scrollIntoViewIfNeeded();
  }

  onClose(): void {
    (<any>this.app).keymap.popScope(this.scope);
    super.onClose();
  }

  handleRename(targetEl: HTMLElement): void {
    targetEl.parentElement.parentElement.removeClass("renaming");
    const originalName = targetEl.dataset.workspaceName;
    const newName = targetEl.textContent;
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

  useSelectedItem = function (evt: MouseEvent | KeyboardEvent) {
    const targetEl = evt.composedPath()[0] as HTMLElement;
    if (targetEl.contentEditable === "true") {
      this.handleRename(targetEl);
      return;
    }
    let workspaceName = this.inputEl.value ? this.inputEl.value : this.chooser.values[this.chooser.selectedItem].item;
    if (!this.values && workspaceName && evt.shiftKey) {
      this.saveAndStay();
      // if (!/^mode:/i.test(workspaceName)) this.setWorkspace(workspaceName);
      // this.close();
      return false;
    } else if (!this.chooser.values) return false;
    let item = this.chooser.values ? this.chooser.values[this.chooser.selectedItem] : workspaceName;
    return void 0 !== item && (this.selectSuggestion(item, evt), true);
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

  renderSuggestion(item: FuzzyMatch<any>, el: HTMLElement): void {
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
      activeIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="none" d="M0 0h24v24H0z"/><path d="M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z"/></svg>`;
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
    renameIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="none" d="M0 0h24v24H0z"/><path d="M12.9 6.858l4.242 4.243L7.242 21H3v-4.243l9.9-9.9zm1.414-1.414l2.121-2.122a1 1 0 0 1 1.414 0l2.829 2.829a1 1 0 0 1 0 1.414l-2.122 2.121-4.242-4.242z"/></svg>`;
    renameIcon.addEventListener("click", event => this.onRenameClick(event, el));
  }

  addDeleteButton(wrapperEl: HTMLElement, workspaceName: string): void {
    const deleteIcon = wrapperEl.createDiv("delete-workspace");
    deleteIcon.setAttribute("aria-label", "Delete workspace");
    deleteIcon.setAttribute("aria-label-position", "top");
    deleteIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="none" d="M0 0h24v24H0z"/><path d="M7 4V2h10v2h5v2h-2v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6H2V4h5zM6 6v14h12V6H6zm3 3h2v8H9V9zm4 0h2v8h-2V9z"/></svg>`;
    deleteIcon.addEventListener("click", event => this.deleteWorkspace(workspaceName));
  }

  addDescription(wrapperEl: HTMLElement, workspaceName: string): void {
    let description;
    try {
      description = this.workspacePlugin.workspaces[workspaceName][SETTINGS_ATTR]["description"];
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
      renameIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" style="vertical-align: -0.125em;" width="16" height="16" preserveAspectRatio="xMidYMid meet" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" fill="none" stroke="none" /><path d="M3 4h17a2 2 0 0 1 2 2v2h-4V6H5v12h9v2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m14 6h6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1m1 2v7h4v-7h-4z" fill="currentColor"/></svg>`;
    } else {
      renameIcon.setAttribute("aria-label", "Desktop workspace");
      renameIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" style="vertical-align: -0.125em;" width="16" height="16" preserveAspectRatio="xMidYMid meet" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" fill="none" stroke="none" /><path d="M21 16H3V4h18m0-2H3c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" fill="currentColor"/></svg>`;
    }
    renameIcon.setAttribute("aria-label-position", "top");
  }

  onRenameClick = function (evt: MouseEvent | KeyboardEvent, el: HTMLElement): void {
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

  onChooseItem(item: any, evt: MouseEvent | KeyboardEvent): void {
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
