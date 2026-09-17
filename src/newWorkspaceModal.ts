import { ColorComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { IconSuggest } from "./suggesters/iconSuggest";
import { DEFAULT_WORKSPACE_ICON, DEFAULT_ICON_COLOR_SWATCH } from "./settings";
import { refreshIfDeclarative } from "./settingsDeclarative";
import WorkspacesPlus from "./main";

// Opened by the "New empty workspace" command (not the settings tab's own "+" button, which
// stays a single click with no dialog -- see its own comment in settings.ts). Collects name/icon/
// color up front rather than reusing buildWorkspaceIconSetting()/buildWorkspaceIconColorSetting():
// those mutate an existing workspace's settings object live, but there's no workspace to attach
// settings to until Create is actually pressed, so this just holds the choices as plain fields
// and hands them to Utils.createBlankWorkspace() all at once.
export class NewWorkspaceModal extends Modal {
  plugin: WorkspacesPlus;
  name = "";
  icon = "";
  iconColor = "";

  constructor(plugin: WorkspacesPlus) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.setTitle("New workspace");

    let nameInputEl: HTMLInputElement;
    new Setting(this.contentEl).setName("Name").addText(text => {
      nameInputEl = text.inputEl;
      text.setPlaceholder("New workspace");
      // Trimmed here (same as the icon field below) rather than left for createBlankWorkspace()
      // to trim internally -- a whitespace-only value needs to read as empty *before* the
      // `this.name || undefined` check in create(), or it's treated as a real name and silently
      // swapped for the auto-generated default with no indication the typed name was rejected.
      text.onChange(value => (this.name = value.trim()));
      text.inputEl.addEventListener("keydown", evt => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          this.create();
        }
      });
    });

    const previewEl = createSpan({ cls: "workspace-icon-preview" });
    setIcon(previewEl, DEFAULT_WORKSPACE_ICON);
    new Setting(this.contentEl)
      .setName("Icon")
      .setDesc("Leave blank to use the default icon.")
      .then(setting => setting.controlEl.prepend(previewEl))
      .addText(text => {
        text.setPlaceholder(DEFAULT_WORKSPACE_ICON);
        new IconSuggest(this.app, text.inputEl);
        text.onChange(value => {
          this.icon = value.trim();
          setIcon(previewEl, this.icon || DEFAULT_WORKSPACE_ICON);
        });
      });

    let colorPicker: ColorComponent;
    new Setting(this.contentEl)
      .setName("Icon color")
      .addColorPicker(picker => {
        colorPicker = picker;
        picker.setValue(DEFAULT_ICON_COLOR_SWATCH).onChange(value => {
          this.iconColor = value;
        });
      })
      .addExtraButton(button =>
        button
          .setIcon("rotate-ccw")
          .setTooltip("Reset to default color")
          .onClick(() => {
            this.iconColor = "";
            colorPicker.setValue(DEFAULT_ICON_COLOR_SWATCH);
          })
      );

    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(button =>
        button
          .setButtonText("Create")
          .setCta()
          .onClick(() => this.create())
      );

    // Matches ConfirmationModal's own focus-delay pattern in confirm.ts -- focusing synchronously
    // on open is unreliable across platforms while the modal is still animating in.
    window.setTimeout(() => nameInputEl.focus(), 50);
  }

  create(): void {
    const result = this.plugin.utils.createBlankWorkspace({
      name: this.name || undefined,
      icon: this.icon || undefined,
      iconColor: this.iconColor || undefined,
    });
    // `=== false`, not `!result.success` -- the latter fails to narrow the union here (though it
    // narrows fine at the other two call sites of createBlankWorkspace, in settings.ts and
    // settingsDeclarative.ts), leaving `result.reason` a type error. Likely this file's own,
    // deeper circular-import chain (main.ts <-> newWorkspaceModal.ts <-> settingsDeclarative.ts
    // <-> settings.ts, plus main.ts <-> utils.ts) confusing the checker; not worth chasing further
    // since this form works reliably.
    if (result.success === false) {
      new Notice(result.reason ?? "Could not create workspace.");
      return;
    }
    this.close();
    this.plugin.workspacePlugin.loadWorkspace(result.name);
    refreshIfDeclarative(this.plugin.settingsTab);
    new Notice(`Created and switched to workspace "${result.name}"`);
  }
}
