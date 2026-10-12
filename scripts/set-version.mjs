#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesktopVersion, compareDesktopVersions, isValidCalendarDate } from "./version-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = (path) => resolve(root, path);
const read = (path) => readFileSync(file(path), "utf8");
const [target, ...args] = process.argv.slice(2);
const noteIndex = args.indexOf("--note");
const note = noteIndex >= 0 ? args[noteIndex + 1]?.trim() : null;
const dateIndex = args.indexOf("--date");
const date = dateIndex >= 0 ? args[dateIndex + 1] : new Date().toISOString().slice(0, 10);
if (!parseDesktopVersion(target) || !note || note.length < 25 ||
    note.includes("\n") || !isValidCalendarDate(date)) {
  console.error('Usage: node scripts/set-version.mjs <semver> --note "Detailed change (25+ chars)" [--date YYYY-MM-DD]');
  process.exit(1);
}
// Fail closed if any version source or changelog section was already inconsistent.
// Without this preflight, a version bump could mask drift and only partly repair it.
const preflight = spawnSync(process.execPath, [file("scripts/check-version.mjs")], {
  cwd: root, encoding: "utf8",
});
if (preflight.status !== 0) {
  console.error("Cannot bump an inconsistent desktop version; run node scripts/check-version.mjs first.");
  if (preflight.stderr) process.stderr.write(preflight.stderr);
  if (preflight.error) console.error(preflight.error.message);
  process.exit(1);
}
const current = JSON.parse(read("apps/desktop/package.json")).version;
if (!parseDesktopVersion(current)) throw new Error(`Invalid current desktop version: ${current}`);
if (compareDesktopVersions(target, current) <= 0) {
  console.error(`Version ${target} must be newer than ${current}; edit CHANGELOG.md for same-version changes`);
  process.exit(1);
}
const writes = new Map();
function updateJson(path, modify) {
  const data = JSON.parse(read(path));
  modify(data);
  writes.set(path, JSON.stringify(data, null, 2) + "\n");
}
updateJson("apps/desktop/package.json", (obj) => { obj.version = target; });
updateJson("apps/desktop/package-lock.json", (obj) => {
  if (obj.version !== current || obj.packages[""].version !== current) {
    throw new Error("npm lockfile does not match current app version");
  }
  obj.version = target;
  obj.packages[""].version = target;
});
updateJson("apps/desktop/src-tauri/tauri.conf.json", (obj) => { obj.version = target; });
updateJson("release/runtime-manifest.json", (obj) => { obj.app.version = target; });
function replaceOnce(path, before, after) {
  const data = read(path);
  const eol = data.includes("\r\n") ? "\r\n" : "\n";
  const find = before.replace(/\r?\n/g, eol);
  const put = after.replace(/\r?\n/g, eol);
  if (data.split(find).length !== 2) throw new Error(`Expected exactly one match in ${path}`);
  writes.set(path, data.replace(find, put));
}
replaceOnce("apps/desktop/src-tauri/Cargo.toml", `version = "${current}"`, `version = "${target}"`);
replaceOnce("Cargo.lock", `name = "zeter-desktop-tauri"\nversion = "${current}"`, `name = "zeter-desktop-tauri"\nversion = "${target}"`);
replaceOnce("README.md", `**${current}** — версия исходного кода`, `**${target}** — версия исходного кода`);
replaceOnce("PROJECT_STATUS.md", "Desktop source version: `" + current + "`", "Desktop source version: `" + target + "`");

const log = read("CHANGELOG.md");
const first = log.search(/^## \[/m);
if (first < 0 || !log.startsWith("## [".concat(current, "]"), first))
  throw new Error("CHANGELOG.md does not begin with current SemVer");
if (log.includes(`## [${target}] —`)) throw new Error("Target version already exists in CHANGELOG.md");
const state = target.includes("-")
  ? "Предварительная версия разработки, пока не опубликована публично."
  : "Версия подготовлена; публикация и подпись требуют отдельной проверенной процедуры.";
const heading = `## [${target}] — ${date}\n\n> ${state}\n\n### Изменено\n\n- ${note}\n\n`;
writes.set("CHANGELOG.md", log.slice(0, first) + heading + log.slice(first));
for (const [path, text] of writes) writeFileSync(file(path), text, "utf8");
console.log(`Updated desktop ${current} → ${target} across ${writes.size} files. Run: node scripts/check-version.mjs`);
