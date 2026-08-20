import { AbstractInputSuggest, App, TAbstractFile, TFile, TFolder } from "obsidian";

export class FileSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, private inputEl: HTMLInputElement) {
    super(app, inputEl);
  }

  getSuggestions(inputStr: string): TFile[] {
    const abstractFiles = this.app.vault.getAllLoadedFiles();
    const files: TFile[] = [];
    const lowerCaseInputStr = inputStr.toLowerCase();

    abstractFiles.forEach((file: TAbstractFile) => {
      if (file instanceof TFile && file.extension === "md" && file.path.toLowerCase().contains(lowerCaseInputStr)) {
        files.push(file);
      }
    });

    return files;
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.inputEl.value = file.path;
    this.inputEl.trigger("input");
    this.close();
  }
}

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, private inputEl: HTMLInputElement) {
    super(app, inputEl);
  }

  getSuggestions(inputStr: string): TFolder[] {
    const abstractFiles = this.app.vault.getAllLoadedFiles();
    const folders: TFolder[] = [];
    const lowerCaseInputStr = inputStr.toLowerCase();

    abstractFiles.forEach((folder: TAbstractFile) => {
      if (folder instanceof TFolder && folder.path.toLowerCase().contains(lowerCaseInputStr)) {
        folders.push(folder);
      }
    });

    return folders;
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.inputEl.value = folder.path;
    this.inputEl.trigger("input");
    this.close();
  }
}
