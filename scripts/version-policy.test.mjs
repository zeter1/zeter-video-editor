import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseDesktopVersion, compareDesktopVersions, isValidCalendarDate } from "./version-policy.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "scripts/version-policy.mjs", "scripts/check-version.mjs", "scripts/set-version.mjs",
  "scripts/release-notes.mjs", "apps/desktop/package.json", "apps/desktop/package-lock.json",
  "apps/desktop/src-tauri/Cargo.toml", "apps/desktop/src-tauri/tauri.conf.json",
  "apps/ai-worker/Cargo.toml", "Cargo.lock", "README.md", "PROJECT_STATUS.md",
  "CHANGELOG.md", "release/runtime-manifest.json",
];
const note = "Проверяется атомарная согласованность обновления версий на всех уровнях приложения.";

function fixture(run) {
  const folder = mkdtempSync(join(tmpdir(), "zeter-version-test-"));
  try {
    for (const name of files) {
      const target = join(folder, name);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(sourceRoot, name), target);
    }
    return run(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function script(folder, scriptName, args = []) {
  return spawnSync(process.execPath, [join(folder, "scripts", scriptName), ...args], {
    cwd: folder,
    encoding: "utf8",
  });
}

test("SemVer rejects invalid numeric prerelease identifiers and compares precedence", () => {
  for (const bad of ["0.1.0-alpha.01", "0.1.0-01", "00.1.0", "0.1.0-", "0.1.0+build.1"]) {
    assert.equal(parseDesktopVersion(bad), null, bad);
  }
  for (const good of ["0.1.0-alpha.1", "0.1.0-alpha.2", "0.1.0-beta.1", "0.1.0"]) {
    assert.ok(parseDesktopVersion(good), good);
  }
  const ordered = ["0.1.0-alpha", "0.1.0-alpha.1", "0.1.0-alpha.2",
    "0.1.0-beta", "0.1.0-rc.1", "0.1.0", "0.1.1"];
  for (let i = 1; i < ordered.length; i += 1) {
    assert.equal(compareDesktopVersions(ordered[i], ordered[i - 1]), 1);
  }
  assert.equal(compareDesktopVersions("0.1.0-alpha.2", "0.1.0-alpha.2"), 0);
  assert.equal(compareDesktopVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992"), 1);
});

test("Changelog dates must be actual calendar dates", () => {
  assert.equal(isValidCalendarDate("2026-10-11"), true);
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01"]) {
    assert.equal(isValidCalendarDate(bad), false);
  }
});

test("version bump updates all manifests and release notes even with CRLF Cargo.lock", () => fixture((folder) => {
  const cargoPath = join(folder, "Cargo.lock");
  writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/\r?\n/g, "\r\n"));
  const updated = script(folder, "set-version.mjs", [
    "0.1.0-alpha.2", "--note", note, "--date", "2026-10-12",
  ]);
  assert.equal(updated.status, 0, updated.stderr);
  const check = script(folder, "check-version.mjs", ["--tag", "v0.1.0-alpha.2"]);
  assert.equal(check.status, 0, check.stderr);
  const notes = script(folder, "release-notes.mjs", ["0.1.0-alpha.2"]);
  assert.equal(notes.status, 0, notes.stderr);
  assert.match(notes.stdout, /## \[0\.1\.0-alpha\.2\] — 2026-10-12/);
  assert.ok(!notes.stdout.includes("## [0.1.0-alpha.1]"));
  assert.ok(readFileSync(cargoPath, "utf8").includes("\r\n"));
}));

test("invalid date, downgrade and numeric-leading-zero prerelease cannot mutate files", () => fixture((folder) => {
  const path = join(folder, "apps/desktop/package.json");
  const before = readFileSync(path, "utf8");
  for (const [version, date] of [
    ["0.1.0-alpha.01", "2026-10-12"],
    ["0.0.9", "2026-10-12"],
    ["0.1.0-alpha.2", "2026-02-30"],
  ]) {
    const result = script(folder, "set-version.mjs", [version, "--note", note, "--date", date]);
    assert.notEqual(result.status, 0, version + " " + date);
    assert.equal(readFileSync(path, "utf8"), before);
  }
}));

test("version check refuses mismatched manifests and incorrectly ordered changelog", () => fixture((folder) => {
  const packagePath = join(folder, "apps/desktop/package.json");
  const originalPackage = readFileSync(packagePath, "utf8");
  writeFileSync(packagePath, originalPackage.replace('"version": "0.1.0-alpha.1"', '"version": "0.1.0-alpha.2"'));
  assert.notEqual(script(folder, "check-version.mjs").status, 0);
  writeFileSync(packagePath, originalPackage);
  const changelogPath = join(folder, "CHANGELOG.md");
  const before = readFileSync(changelogPath, "utf8");
  writeFileSync(changelogPath, before.replace("## [0.0.1] — 2026-10-07", "## [0.2.0] — 2026-10-07"));
  assert.notEqual(script(folder, "check-version.mjs").status, 0);
}));
