import { AbstractInputSuggest, App, getIconIds, setIcon } from "obsidian";

export class IconSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private inputEl: HTMLInputElement) {
    super(app, inputEl);
  }

  getSuggestions(inputStr: string): string[] {
    const query = inputStr.toLowerCase();
    return getIconIds().filter(iconId => iconId.toLowerCase().contains(query));
  }

  renderSuggestion(iconId: string, el: HTMLElement): void {
    el.addClass("workspace-icon-suggestion");
    setIcon(el.createSpan(), iconId);
    el.createSpan({ text: iconId });
  }

  selectSuggestion(iconId: string): void {
    this.inputEl.value = iconId;
    this.inputEl.trigger("input");
    this.close();
  }
}
