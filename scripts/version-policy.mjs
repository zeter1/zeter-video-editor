// Shared desktop SemVer validation for release scripts. Build metadata is intentionally
// excluded because npm/Tauri/Cargo packaging uses one exact, comparable version string.
const PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseDesktopVersion(value) {
  if (typeof value !== "string") return null;
  const match = PATTERN.exec(value);
  if (!match) return null;
  const prerelease = match[4] ? match[4].split(".") : [];
  // SemVer 2.0 forbids leading zeroes in numeric prerelease identifiers.
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0")) {
    return null;
  }
  return {
    core: match.slice(1, 4).map((part) => BigInt(part)),
    prerelease,
  };
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (leftNumeric) {
    const a = BigInt(left), b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // JavaScript < and > compare ASCII characters by code units, matching SemVer.
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareDesktopVersions(left, right) {
  const a = parseDesktopVersion(left), b = parseDesktopVersion(right);
  if (!a || !b) throw new Error("Invalid desktop SemVer supplied for comparison");
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i += 1) {
    const result = compareIdentifier(a.prerelease[i], b.prerelease[i]);
    if (result !== 0) return result;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
}

export function isValidCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
