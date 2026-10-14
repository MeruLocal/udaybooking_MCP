#!/usr/bin/env node
/**
 * Fails when package.json, server.json `version` and any server.json
 * `packages[*].version` disagree. Run by `npm test`, so a version bump that
 * forgets one of them breaks the suite instead of the registry listing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
const server = JSON.parse(readFileSync(`${root}server.json`, "utf8"));

const found = [
  ["package.json version", pkg.version],
  ["server.json version", server.version],
  ...(server.packages ?? []).map((p, i) => [`server.json packages[${i}].version`, p.version]),
];

const mismatched = found.filter(([, v]) => v !== pkg.version);
if (mismatched.length > 0) {
  for (const [where, v] of found) console.error(`  ${where}: ${v}`);
  console.error("check-versions: versions differ; bump them together.");
  process.exit(1);
}
console.log(`check-versions: ${found.length} version field(s) agree on ${pkg.version}`);
