"use strict";
// Release notes for the update pop-up's "what's new" box: one short line per change since the previous release, taken from the commit
// subjects. The release workflow runs this after publishing and puts the result in the GitHub release body (the app reads it from there).
//
//   node tools/release-notes.js 0.3.23        prints the notes for v0.3.23 (commits since the previous v* tag)
const { execFileSync } = require("child_process");

const SKIP = /^(bump version\b|release \d|merge\b|packaging test\b)/i; // version bumps and release markers are not changes the user sees
const semver = v => String(v).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
const cmp = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// "Fortnite in-game HUD from MJ's references: players and teams left, killfeed, ..." -> "Fortnite in-game HUD from MJ's references"
function line(subject) {
  let s = String(subject || "").replace(/\s+/g, " ").trim();
  // no names of other products or people in public notes
  s = s.replace(/\s+like BLOB['’]?s?\b/gi, "").replace(/\bBLOB['’]?s?\b/gi, "the reference").replace(/\bMJ['’]s\s+/g, "");
  const cut = s.search(/: | \(| - /);
  if (cut > 12) s = s.slice(0, cut);
  s = s.replace(/[.,;:\s]+$/, "");
  if (s.length > 110) s = s.slice(0, 107).replace(/\s+\S*$/, "") + "…";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function notesFrom(subjects, max = 12) {
  const seen = new Set(), out = [];
  for (const sub of subjects || []) {
    if (!sub || SKIP.test(String(sub).trim())) continue;
    const l = line(sub), k = l.toLowerCase();
    if (!l || seen.has(k)) continue;
    seen.add(k); out.push("- " + l);
  }
  if (!out.length) return "Fixes and small improvements.\n";
  const more = out.length - max;
  return out.slice(0, max).join("\n") + (more > 0 ? `\n- …and ${more} more` : "") + "\n";
}

// the tag just below this version, so a release always covers exactly what changed since the last one
function previousTag(version, tags) {
  const cur = "v" + String(version).replace(/^v/, "");
  return (tags || []).filter(t => /^v\d+\.\d+\.\d+$/.test(t) && cmp(t, cur) < 0).sort(cmp).pop() || "";
}

function main() {
  const version = process.argv[2];
  if (!/^v?\d+\.\d+\.\d+$/.test(version || "")) { console.error("usage: node tools/release-notes.js <version>"); process.exit(2); }
  const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 16e6 });
  const prev = previousTag(version, git(["tag", "--list", "v*"]).split(/\r?\n/).filter(Boolean));
  const range = prev ? [`${prev}..HEAD`] : ["-n", "20"];
  process.stdout.write(notesFrom(git(["log", ...range, "--no-merges", "--pretty=%s"]).split(/\r?\n/).filter(Boolean)));
}

if (require.main === module) main();
module.exports = { notesFrom, line, previousTag, cmp };
