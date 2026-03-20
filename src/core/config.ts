import * as fs from "node:fs/promises";
import { configFile, configDir } from "./paths.js";

/**
 * Backpack configuration.
 *
 * Stored at ~/.config/backpack/config.json (or $XDG_CONFIG_HOME/backpack/config.json).
 * All fields are optional — sensible defaults are used when absent.
 */
export interface BackpackConfig {
  /** Override the data directory (where ontologies are stored). */
  dataDir?: string;
}

const DEFAULT_CONFIG: BackpackConfig = {};

/**
 * Load config from disk. Returns defaults if the file doesn't exist.
 * Creates the config directory (but not the file) on first run.
 */
export async function loadConfig(): Promise<BackpackConfig> {
  // Ensure config directory exists
  await fs.mkdir(configDir(), { recursive: true });

  try {
    const raw = await fs.readFile(configFile(), "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}
