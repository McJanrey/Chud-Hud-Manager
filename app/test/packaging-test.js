// The installed app only contains the files listed in package.json "files". A module that is required but not listed crashes the
// installed app on start (it happened with league.js, fields.js and minecraft.js, and again with draft.js), while every test that
// runs from the source folder still passes. This test builds the installed layout and starts the server from it.
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");
const ROOT = path.join(__dirname, "..");
const pkg = require("../package.json");
let bad = 0;
const ok = (c, m, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${m} ${c ? "" : x}`); if (!c) bad++; };

const lotd = require("../electron-builder.lotd.js"), wwl = require("../electron-builder.wwl.js");
const listFor = cfg => cfg.files.filter(p => !p.startsWith("!"));
const covered = (file, list) => list.some(p => p === file || (p.endsWith("/**/*") && file.startsWith(p.slice(0, -4))));

// every local file the app can require, starting from the two entry points
const seen = new Set(), stack = ["main.js", "preload.js"];
while (stack.length) {
  const f = stack.pop();
  if (seen.has(f) || !fs.existsSync(path.join(ROOT, f))) continue;
  seen.add(f);
  if (!f.endsWith(".js")) continue;
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    const p = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])); // forward slashes on Windows too, like the "files" list
    const hit = [p, p + ".js", p + ".json", p + "/index.js"].find(c => fs.existsSync(path.join(ROOT, c)) && fs.statSync(path.join(ROOT, c)).isFile());
    if (hit) stack.push(hit); else ok(false, `${f} requires ${m[1]} which does not exist`);
  }
}
for (const [name, cfg] of [["standard", pkg.build], ["LOTD", lotd], ["WWL", wwl]]) {
  const missing = [...seen].filter(f => f !== "test/ocr-selftest.js" && !covered(f, listFor(cfg)));
  ok(!missing.length, `the ${name} installer contains every file the app requires`, "missing: " + missing.join(", "));
}

// build the installed layout in a temp folder and start the real server from it
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-")), copy = (rel) => {
  const from = path.join(ROOT, rel), to = path.join(tmp, rel);
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
};
for (const p of listFor(pkg.build)) copy(p.endsWith("/**/*") ? p.slice(0, -5) : p);
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(tmp, "node_modules"), "junction");
const child = spawn(process.execPath, ["-e", "const s=require('./server.js');s.server.once('listening',()=>{console.log('LISTENING');process.exit(0)});setTimeout(()=>process.exit(3),15000)"],
  { cwd: tmp, env: Object.assign({}, process.env, { SAINTS_DATA: path.join(tmp, "data"), PORT: "7812", CAM_PORT: "7813", CHUDHUD_VARIANT: "" }) });
let out = ""; child.stdout.on("data", d => out += d); child.stderr.on("data", d => out += d);
child.on("exit", code => {
  ok(code === 0 && out.includes("LISTENING"), "the server starts from the installed layout", out.split("\n").filter(l => /Error|Cannot find/.test(l)).slice(0, 3).join(" | "));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `\n${bad} CHECK(S) FAILED` : "\nPACKAGING TEST PASS");
  process.exit(bad ? 1 : 0);
});
