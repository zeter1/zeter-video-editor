#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [version, ...args] = process.argv.slice(2);
const matchVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
if (!matchVersion.test(version ?? "")) {
  console.error("Usage: node scripts/release-notes.mjs <semver> [--output file.md]");
  process.exit(1);
}
const doc = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const heading = `## [${version}] — `;
const lines = doc.split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(heading));
if (start < 0) throw new Error(`No changelog section for version ${version}`);
let end = start + 1;
while (end < lines.length && !lines[end].startsWith("## [")) end++;
const notes = lines.slice(start, end).join("\n").trim() + "\n";
if (!/^- \S.{20,}/m.test(notes)) throw new Error("Version has no detailed release notes");
const outputIndex = args.indexOf("--output");
if (outputIndex >= 0) {
  const dest = args[outputIndex + 1];
  if (!dest) throw new Error("--output requires a path");
  writeFileSync(resolve(process.cwd(), dest), notes, "utf8");
  console.log(`Wrote release notes for ${version}: ${dest}`);
} else {
  process.stdout.write(notes);
}
