#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");
const json = (name) => JSON.parse(read(name));
const packageVersion = json("apps/desktop/package.json").version;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const errors = [];
const assert = (ok, message) => { if (!ok) errors.push(message); };
function cargoVersion(file, name) {
  const text = read(file);
  const block = file === "Cargo.lock"
    ? text.split("[[package]]").find((part) =>
        part.split(/\r?\n/).some((line) => line.trim() === `name = "${name}"`))
    : text.split("[dependencies]")[0];
  const found = block?.match(/^version = "([^"]+)"\r?$/m);
  assert(Boolean(found), `Cannot read ${name} version from ${file}`);
  return found?.[1];
}
assert(semver.test(packageVersion), `Invalid desktop SemVer: ${packageVersion}`);
for (const [name, value] of Object.entries({
  "npm package-lock": json("apps/desktop/package-lock.json").version,
  "npm package-lock root": json("apps/desktop/package-lock.json").packages[""].version,
  "Tauri config": json("apps/desktop/src-tauri/tauri.conf.json").version,
  "Tauri Cargo package": cargoVersion("apps/desktop/src-tauri/Cargo.toml", "zeter-desktop-tauri"),
  "Cargo.lock Tauri package": cargoVersion("Cargo.lock", "zeter-desktop-tauri"),
  "runtime manifest app": json("release/runtime-manifest.json").app.version,
})) {
  assert(value === packageVersion, `${name}: expected ${packageVersion}, got ${value}`);
}
const aiWorkerVersion = cargoVersion("apps/ai-worker/Cargo.toml", "zeter-ai-worker");
assert(json("release/runtime-manifest.json").ai_worker.build_identity === aiWorkerVersion,
  "AI worker manifest identity and worker Cargo version differ");
const changelog = read("CHANGELOG.md");
assert(!/^##\s+(?:\[)?Unreleased(?:\])?\s*$/im.test(changelog),
  "Unversioned changelog heading is forbidden");
const sections = [...changelog.matchAll(/^## \[([^\]]+)\] — (\d{4}-\d\d-\d\d)\s*$/gm)];
assert(sections.length > 0, "CHANGELOG.md has no dated version sections");
assert(sections[0]?.[1] === packageVersion,
  `Top changelog version must be ${packageVersion}`);
assert(new Set(sections.map((x) => x[1])).size === sections.length,
  "Duplicate version section in CHANGELOG.md");
for (let i = 0; i < sections.length; i += 1) {
  const section = changelog.slice(sections[i].index, sections[i + 1]?.index ?? changelog.length);
  assert(/^### (?:Добавлено|Изменено|Устарело|Удалено|Исправлено|Безопасность|Документация)$/m.test(section),
    `Version ${sections[i][1]} is missing category headings`);
  assert(/^- \S.{20,}/m.test(section), `Version ${sections[i][1]} needs detailed bullet entries`);
}
const tagAt = process.argv.indexOf("--tag");
if (tagAt >= 0) {
  const tag = process.argv[tagAt + 1];
  assert(tag === `v${packageVersion}`, `Tag must equal v${packageVersion}, got ${tag ?? "<missing>"}`);
}
if (errors.length) {
  for (const err of errors) console.error(`VERSION ERROR: ${err}`);
  process.exitCode = 1;
} else {
  console.log(`Version OK: ${packageVersion}; ${sections.length} changelog sections; worker ${aiWorkerVersion} (independent)`);
}
