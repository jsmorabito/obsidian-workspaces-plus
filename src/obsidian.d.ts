/* eslint-disable no-undef -- Events/EventRef are members of the "obsidian" module being
   augmented below; TS resolves them implicitly inside declare module, but eslint's no-undef
   doesn't understand that TS-specific semantics. tsc has no complaints, and the build succeeds. */
import "obsidian";

declare module "obsidian" {
  export interface FuzzySuggestModal<T> {
    chooser: Chooser<T>;
    suggestEl: HTMLDivElement;
  }

  export interface Chooser<T> {
    setSelectedItem(selectedIdx: number, scroll?: boolean): void;
    useSelectedItem(evt: MouseEvent | KeyboardEvent): void;
    values: { [x: string]: { item: T } };
    selectedItem: number;
    chooser: Chooser<T>;
    setSuggestions(items: T[]): void;
    containerEl: HTMLElement;
    addMessage(message: string): void;
    updateSuggestions(): void;
    suggestions: { scrollIntoViewIfNeeded: () => void }[];
  }
  export interface Vault {
    getConfig(config: string): unknown;
    setConfig(config: string, value: unknown): void;
    readConfigJson(section: string): Promise<unknown>;
    saveConfig(): void;
    exists(path: string): Promise<boolean>;
    writeJson(fileName: string, workspaceMetadata: object, prettyPrint: boolean): Promise<void>;
    config: object;
  }
  export interface Vault extends Events {
    on(name: "config-changed", callback: () => void): EventRef;
  }
  export interface App {
    isMobile(): boolean;
    setTheme(mode: string): void;
    internalPlugins: InternalPlugins;
    viewRegistry: ViewRegistry;
    getTheme(): string;
    changeBaseFontSize(fontSize: number): void;
    changeTheme(theme: string): void;
    customCss: {
      theme: string;
      loadData(): void;
      applyCss(): void;
      setTheme(theme: string): void;
    };
    plugins: {
      plugins: {
        "cmenu-plugin": {
          _loaded: boolean;
          settings: { menuCommands: { id: string; name: string }[] };
          saveSettings(): void;
        };
      };
    };
  }

  export interface InstalledPlugin {
    enabled: boolean;
    _loaded: boolean;
    instance: PluginInstance;
  }

  export interface InternalPlugins {
    plugins: Record<string, InstalledPlugin>;
    getPluginById(id: string): InstalledPlugin;
    on(name: "change", callback: (plugin: InstalledPlugin) => void, ctx?: unknown): EventRef;
  }

  export interface ViewRegistry {
    viewByType: Record<string, unknown>;
    isExtensionRegistered(extension: string): boolean;
  }

  export interface PluginInstance {
    id: string;
    name: string;
    description: string;
    _loaded: boolean;
  }

  export interface WorkspacePluginInstance extends PluginInstance {
    deleteWorkspace(workspaceName: string): void;
    saveWorkspace(workspaceName: string): void;
    loadWorkspace(workspaceName: string): void;
    setActiveWorkspace(workspaceName: string): void;
    plugin: PluginInstance;
    activeWorkspace: string;
    saveData(): void;
    workspaces: { [x: string]: Workspaces }; // TODO: improve this typing
  }

  export interface Workspace extends Events {
    updateOptions(): void;
    on(name: "workspace-load", callback: (workspaceName: string) => void, ctx?: unknown): EventRef;
    on(
      name: "workspace-save",
      callback: (workspaceName: string, modeName: string) => void | Promise<void>,
      ctx?: unknown
    ): EventRef;
    on(name: "workspace-delete", callback: (workspaceName: string) => void, ctx?: unknown): EventRef;
    on(
      name: "workspace-rename",
      callback: (newWorkspaceName: string, oldWorkspaceName: string) => void,
      ctx?: unknown
    ): EventRef;
  }

  export interface Workspaces {
    main?: WorkspaceLayoutNode;
    left?: WorkspaceLayoutNode;
    right?: WorkspaceLayoutNode;
    active?: string;
    [x: string]: any; // includes the plugin's own settings key (workspaces-plus:settings-v1) and other internal/dynamic keys
  }

  // The recursive pane/split/tab layout tree Obsidian persists per workspace. Undocumented,
  // but stable and consistent enough across this plugin's usage (setChildId, captureOpenFiles,
  // restoreOpenFiles, mergeSidebarLayout) to be worth naming instead of leaving as `any`.
  export interface WorkspaceLayoutNode {
    type: string;
    id?: string;
    children?: WorkspaceLayoutNode[];
    state?: { state?: { file?: string | null; [x: string]: unknown }; [x: string]: unknown };
    [x: string]: unknown;
  }

  // This plugin's own per-workspace settings blob, stored at workspace[SETTINGS_ATTR].
  // Unlike Workspaces/WorkspaceLayoutNode this isn't Obsidian internals — it's fully owned by
  // this plugin, so its shape is exact rather than a best-effort approximation.
  export interface WorkspaceCustomSettings {
    mode?: string | null;
    description?: string;
    fileOverrides?: Record<string, string>;
    trackedFiles?: Record<string, string>;
    explorerFoldState?: unknown;
    saveSidebar?: boolean;
    app?: object;
    [x: string]: unknown;
  }
}
/* eslint-enable no-undef -- end of the declare module "obsidian" augmentation block */
