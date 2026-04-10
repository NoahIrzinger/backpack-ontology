// ============================================================
// Docker-style random author name generator.
//
// When a user hasn't set BACKPACK_AUTHOR, Backpack needs SOMETHING
// to attribute events and lock heartbeats to. The obvious fallback
// is "unknown," but that's both ugly in the viewer (the lock badge
// just says "editing: unknown") and useless for collaboration
// (you can't tell two "unknown" users apart).
//
// Instead, we generate a fun two-word name deterministically from
// the machine's hostname + platform + arch. Same machine always
// gets the same name, so lock heartbeats are stable across runs
// without needing a config file or any persistent state.
//
// Users who want a real name set BACKPACK_AUTHOR explicitly.
// ============================================================

import * as os from "node:os";
import * as crypto from "node:crypto";

// Picked to be SFW, positive, visually distinctive when rendered
// next to each other in the viewer's lock badge. 50 entries.
const ADJECTIVES = [
  "brave",
  "clever",
  "swift",
  "curious",
  "gentle",
  "bold",
  "bright",
  "calm",
  "eager",
  "cheerful",
  "witty",
  "fierce",
  "nimble",
  "jolly",
  "keen",
  "lively",
  "merry",
  "neat",
  "proud",
  "quick",
  "sharp",
  "sunny",
  "vivid",
  "wise",
  "zesty",
  "cosmic",
  "dapper",
  "epic",
  "fuzzy",
  "groovy",
  "hearty",
  "jazzy",
  "lucky",
  "mellow",
  "noble",
  "peppy",
  "quirky",
  "radiant",
  "snazzy",
  "tidy",
  "upbeat",
  "vibrant",
  "wild",
  "stellar",
  "silver",
  "golden",
  "crimson",
  "cyan",
  "lunar",
  "zen",
];

// Animals, celestial bodies, natural features. Avoids naming specific
// real people (no political or cultural landmines) and avoids any
// potentially loaded terms. 50 entries.
const NOUNS = [
  "otter",
  "fox",
  "wolf",
  "lynx",
  "hawk",
  "owl",
  "heron",
  "raven",
  "badger",
  "beaver",
  "panda",
  "koala",
  "cheetah",
  "jaguar",
  "lemur",
  "ocelot",
  "seal",
  "tiger",
  "whale",
  "zebra",
  "mantis",
  "narwhal",
  "okapi",
  "puffin",
  "quokka",
  "salamander",
  "toucan",
  "vulture",
  "walrus",
  "yak",
  "comet",
  "galaxy",
  "nebula",
  "pulsar",
  "quasar",
  "supernova",
  "asteroid",
  "meteor",
  "moon",
  "star",
  "sun",
  "cosmos",
  "planet",
  "cloud",
  "river",
  "mountain",
  "forest",
  "valley",
  "island",
  "glacier",
];

/**
 * Generate a deterministic docker-style two-word name for the current
 * machine. Same hostname+platform+arch always yields the same name.
 *
 * Format: `adjective-noun` (kebab-case, lowercase). Examples:
 *   brave-otter, cosmic-narwhal, zen-glacier
 *
 * Total of 2500 possible combinations — plenty of variety for the
 * small number of collaborators a single person shares graphs with,
 * and well below the ~60 needed for a 50% collision chance by
 * birthday math.
 */
export function generateAuthorName(): string {
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  const hash = crypto.createHash("sha256").update(seed).digest();
  const adjIdx = hash.readUInt32BE(0) % ADJECTIVES.length;
  const nounIdx = hash.readUInt32BE(4) % NOUNS.length;
  return `${ADJECTIVES[adjIdx]}-${NOUNS[nounIdx]}`;
}

/**
 * Resolve the effective author name for the current process.
 *
 * Resolution order:
 *   1. Explicit option passed to the backend constructor
 *   2. $BACKPACK_AUTHOR env var
 *   3. Generated docker-style name from the machine fingerprint
 *
 * Always returns a non-empty string. Never returns "unknown".
 */
export function resolveAuthorName(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  const env = process.env.BACKPACK_AUTHOR;
  if (env && env.length > 0) return env;
  return generateAuthorName();
}
