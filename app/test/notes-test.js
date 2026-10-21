// Run with: node test/notes-test.js
// The update pop-up's "what's new" text comes from the release body, which the release workflow fills from commit subjects.
"use strict";
const { execFileSync } = require("child_process"), path = require("path");
const R = require("../tools/release-notes.js");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ok  " : " FAIL ", name, ok ? "" : extra); if (!ok) failures++; };

check("a long subject is cut at its first colon", R.line("Fortnite in-game HUD from the references: players and teams left, killfeed, event box") === "Fortnite in-game HUD from the references");
check("or at its first bracket", R.line("VALORANT HUD fixes (clock, tab, scores)") === "VALORANT HUD fixes");
check("a short colon is kept (it is part of the sentence)", R.line("Fix: x") === "Fix: x");
check("a very long subject without punctuation is shortened with an ellipsis", (l => l.length <= 110 && l.endsWith("…"))(R.line("word ".repeat(40))));
check("other products and people are not named in public notes", R.line("New team starts blank like BLOB's") === "New team starts blank" && R.line("Lineup laid out on MJ's 1920x1080 wireframe") === "Lineup laid out on 1920x1080 wireframe" && !/blob|\bMJ\b/i.test(R.line("Delete pop-up like BLOB's")));
check("the first letter is capitalised and trailing punctuation dropped", R.line("fix the logo.") === "Fix the logo");

const n = R.notesFrom(["Bump version to 0.3.9", "Release 0.3.9", "Merge branch x", "Add map veto page: BO1 to BO9", "Add map veto page: again", "Fix the crop dialog", "Packaging test: slashes"]);
check("version bumps, release markers, merges and the packaging test are left out", !/bump|release 0|merge|packaging/i.test(n), n);
check("each change is one bullet, repeated lines once", n === "- Add map veto page\n- Fix the crop dialog\n", JSON.stringify(n));
check("no real changes still says something", R.notesFrom(["Bump version to 1.0.0"]) === "Fixes and small improvements.\n" && R.notesFrom([]) === "Fixes and small improvements.\n");
check("a long list is capped with a count of the rest", (t => t.split("\n").length === 14 && /…and 3 more/.test(t))(R.notesFrom(Array.from({ length: 15 }, (_, i) => "Change number " + i))));

check("version order is numeric (0.3.10 is after 0.3.9)", R.cmp("v0.3.10", "v0.3.9") > 0 && R.cmp("0.4.0", "0.3.99") > 0 && R.cmp("v1.0.0", "1.0.0") === 0);
check("the previous tag is the one just below, ignoring odd tags", R.previousTag("0.3.23", ["v0.3.9", "v0.3.10", "v0.3.22", "v0.3.23", "v0.3.24", "nightly", "v0.3.22-beta"]) === "v0.3.22");
check("the first release has no previous tag", R.previousTag("0.1.0", ["v0.1.0"]) === "");

// releases go public only when complete: builds upload into a draft, and one last step publishes it once all three update files are there
const wf = require("fs").readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "release.yml"), "utf8");
const pubI = wf.indexOf("name: Publish the release"), lastBuildI = wf.lastIndexOf("electron-builder --config electron-builder.wwl.js");
check("every edition builds into a draft release", require("../package.json").build.publish[0].releaseType === "draft" && require("../electron-builder.lotd.js").publish[0].releaseType === "draft" && require("../electron-builder.wwl.js").publish[0].releaseType === "draft");
check("a last step publishes the release, after the final build", pubI > lastBuildI && lastBuildI > 0 && /draft=false/.test(wf.slice(pubI)));
check("it refuses to publish unless latest.yml, lotd.yml and wwl.yml are all there", /for f in latest.yml lotd.yml wwl.yml/.test(wf.slice(pubI)) && /not publishing/.test(wf.slice(pubI)));
check("the what's new text goes out with it", /release-notes.js/.test(wf.slice(pubI)) && /body=/.test(wf.slice(pubI)));

const bad = (() => { try { execFileSync(process.execPath, [path.join(__dirname, "..", "tools", "release-notes.js"), "not-a-version"], { stdio: "pipe" }); return false; } catch (e) { return e.status === 2; } })();
check("the script refuses a bad version", bad);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nNOTES TEST PASS");
process.exit(failures ? 1 : 0);
