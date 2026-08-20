import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "main.js",
    "main.js.map",
    "tests",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "rollup.config.js",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "manifest.json"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    // settingsDeclarative.ts implements getSettingDefinitions/getControlValue/setControlValue
    // (Obsidian 1.13.0+), used by WorkspacesPlusSettingsTab alongside display() in settings.ts
    // as a fallback for 1.8.7-1.12.x. Obsidian itself only calls the newer methods when
    // getSettingDefinitions() is in play, i.e. only on 1.13.0+, so no-unsupported-api's warning
    // doesn't apply here -- this file is a deliberate two-tier implementation, not an
    // accidental version mismatch. Scoped to just this file (not all of settings.ts) so the
    // check stays active for display() and the rest of the settings tab.
    files: ["src/settingsDeclarative.ts"],
    rules: {
      "obsidianmd/no-unsupported-api": "off",
    },
  }
);
