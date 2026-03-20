import * as path from "node:path";
import * as os from "node:os";

/**
 * XDG Base Directory paths for Backpack.
 *
 * Follows the same convention as neovim, opencode, alacritty, etc:
 *   Config: $XDG_CONFIG_HOME/backpack  →  ~/.config/backpack
 *   Data:   $XDG_DATA_HOME/backpack    →  ~/.local/share/backpack
 *
 * Override everything with $BACKPACK_DIR (points both config and data there).
 */

export function configDir(): string {
  if (process.env.BACKPACK_DIR) {
    return path.join(process.env.BACKPACK_DIR, "config");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "backpack");
}

export function dataDir(): string {
  if (process.env.BACKPACK_DIR) {
    return path.join(process.env.BACKPACK_DIR, "data");
  }
  const xdgData = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdgData, "backpack");
}

export function configFile(): string {
  return path.join(configDir(), "config.json");
}
