#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";

const BLOCKED = [
  "delgate", "chester", "amdocs", "wipro", "denali", "brink",
  "noah.irzinger", "noahirzinger@gmail",
  "dossier-for-aaron",
];

const ALLOWED_PATHS = [
  "scripts/check-private-data.mjs",
  "node_modules/",
  "dist/",
  ".git/",
];

const BLOCKED_PATTERN = new RegExp(
  "(?<![\\w-])(" + BLOCKED.map((s) => s.replace(/\./g, "\\.")).join("|") + ")(?![\\w-])",
  "gi",
);

async function* walk(dir, root) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (ALLOWED_PATHS.some((p) => rel.startsWith(p))) continue;
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (entry.isDirectory()) {
      yield* walk(full, root);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs|md|json|yml|yaml|html)$/.test(entry.name)) {
      yield rel;
    }
  }
}

const root = process.cwd();
const hits = [];
for await (const rel of walk(root, root)) {
  const text = await fs.readFile(path.join(root, rel), "utf8");
  let m;
  BLOCKED_PATTERN.lastIndex = 0;
  while ((m = BLOCKED_PATTERN.exec(text)) !== null) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const lineNo = text.slice(0, m.index).split("\n").length;
    hits.push({ rel, lineNo, term: m[0], line: line.trim().slice(0, 120) });
  }
}

if (hits.length > 0) {
  process.stderr.write(`\x1b[31mblocked: private/example data found in ${hits.length} place(s):\x1b[0m\n`);
  for (const h of hits) {
    process.stderr.write(`  ${h.rel}:${h.lineNo}  [${h.term}]  ${h.line}\n`);
  }
  process.stderr.write(`\nthese names are flagged because they have appeared as real client/personal data.\n`);
  process.stderr.write(`use neutral placeholders (my-graph, client-acme, foo) in OSS source.\n`);
  process.exit(1);
}
process.stdout.write(`\x1b[32mok:\x1b[0m no private/example data found.\n`);
