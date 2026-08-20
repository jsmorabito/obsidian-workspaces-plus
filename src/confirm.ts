import { App, Modal } from "obsidian";

interface IConfirmationDialogParams {
  cta: string;
  onAccept: (...args: any[]) => Promise<void>;
  text: string;
  title: string;
}

export class ConfirmationModal extends Modal {
  constructor(app: App, config: IConfirmationDialogParams) {
    super(app);
    this.modalEl.addClass("workspace-delete-confirm-modal");
    const { cta, onAccept, text, title } = config;

    this.contentEl.createEl("h3", { text: title });

    let e: HTMLParagraphElement = this.contentEl.createEl("p", { text });
    e.id = "workspace-delete-confirm-dialog";

    this.contentEl.createDiv("modal-button-container", buttonsEl => {
      buttonsEl.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

      const btnSumbit = buttonsEl.createEl("button", {
        attr: { type: "submit" },
        cls: "mod-cta",
        text: cta,
      });
      btnSumbit.addEventListener("click", () => {
        void (async () => {
          try {
            await onAccept();
            this.close();
          } catch (e) {
            console.error("failed to confirm action:", e);
          }
        })();
      });
      setTimeout(() => {
        btnSumbit.focus();
      }, 50);
    });
  }
}

export function createConfirmationDialog(app: App, { cta, onAccept, text, title }: IConfirmationDialogParams): void {
  new ConfirmationModal(app, { cta, onAccept, text, title }).open();
}
