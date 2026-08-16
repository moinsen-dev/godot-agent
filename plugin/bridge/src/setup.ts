import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** plugin/bridge/src/setup.ts -> plugin/addon/addons/godot_agent */
const ADDON_SRC = join(HERE, "..", "..", "addon", "addons", "godot_agent");

const AUTOLOAD_LINE = 'GodotAgent="*res://addons/godot_agent/agent_bridge.gd"';

/**
 * Copy the addon into the project and register the autoload.
 *
 * Registering it directly in project.godot (rather than only shipping an
 * EditorPlugin) means the bridge works without anyone opening the editor.
 */
export function installAddon(project: string): { addon: string; autoload: "added" | "already-present" } {
  if (!existsSync(ADDON_SRC)) {
    throw new Error(`Addon source missing at ${ADDON_SRC}`);
  }
  const dest = join(project, "addons", "godot_agent");
  cpSync(ADDON_SRC, dest, { recursive: true });

  const cfgPath = join(project, "project.godot");
  let cfg = readFileSync(cfgPath, "utf8");
  if (cfg.includes("GodotAgent=")) {
    return { addon: dest, autoload: "already-present" };
  }

  if (/^\[autoload\]\s*$/m.test(cfg)) {
    cfg = cfg.replace(/^\[autoload\]\s*$/m, `[autoload]\n\n${AUTOLOAD_LINE}`);
  } else {
    cfg = cfg.trimEnd() + `\n\n[autoload]\n\n${AUTOLOAD_LINE}\n`;
  }
  writeFileSync(cfgPath, cfg);
  return { addon: dest, autoload: "added" };
}
