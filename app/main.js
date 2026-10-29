// Desktop shell: runs the Chud Hud server inside the app and shows the control room in its own window.
// OBS still reads the overlay from http://localhost:7777/overlay while the app is open.
"use strict";
const { app, BrowserWindow, Menu, shell, dialog, clipboard, globalShortcut, ipcMain } = require("electron");
const path = require("path");
const V = require("./variant.js"); // the standard app, or a themed edition such as Chud Hud LOTD
const fs = require("fs");

// `Chud Hud.exe --ocr-selftest` checks that screen capture and text reading work on this PC.
if (process.argv.includes("--ocr-selftest")) { require("./test/ocr-selftest.js"); return; }
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
if (process.platform === "win32") app.setAppUserModelId(V.appId); // same id as the installer's shortcuts, so the taskbar and Start keep the right icon

// The product used to be called "Saints HUD": keep that userData folder so a renamed install still finds its events, settings and backups.
// An edition such as Chud Hud LOTD keeps its own folder, so it never touches the standard app's events.
app.setPath("userData", path.join(app.getPath("appData"), V.dataDir));
process.env.SAINTS_DATA = process.env.SAINTS_DATA || path.join(app.getPath("userData"), "data");
let win = null, launcher = null, base = "";

/* ---- launcher: sign-in, update status and the way into the control room ---- */
// There is no account server: signing in saves a local profile (name and email) on this PC. Preferences live next to it.
const LAUNCHER_FILE = () => path.join(process.env.SAINTS_DATA, "launcher.json");
let LS = { profile: null, prefs: {} };
function loadLauncher() { try { const j = JSON.parse(fs.readFileSync(LAUNCHER_FILE(), "utf8")); LS = { profile: j.profile || null, prefs: j.prefs || {} }; } catch { /* first run */ } }
function saveLauncher() { try { fs.mkdirSync(path.dirname(LAUNCHER_FILE()), { recursive: true }); fs.writeFileSync(LAUNCHER_FILE(), JSON.stringify(LS, null, 2)); } catch { /* read-only folder: keep going */ } }
// state: source (running from source) | idle | checking | none | available | downloading | ready | installing | error
let upd = { state: "idle", version: "", percent: 0, error: "" };
function setUpdate(patch) { upd = Object.assign({}, upd, patch); if (launcher) launcher.webContents.send("launcher:update", upd); if (win) win.webContents.send("app:update", upd); } // the launcher and the control room's update pop-up

// Every event has its own overlay link; they are all live at once.
let dbOf = () => null, menuSig = "";
const eventsList = () => { const d = dbOf(); return d && Array.isArray(d.events) ? d.events : []; };
const overlayUrl = id => `${base}/overlay?scene=auto${id ? "&event=" + encodeURIComponent(id) : ""}`;
const overlayItems = () => { const l = eventsList(); return l.length ? l.map(e => ({ label: `${e.name} (${e.game})`, click: () => clipboard.writeText(overlayUrl(e.id)) })) : [{ label: "No events yet", enabled: false }]; };

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1100, height: 770, minWidth: 900, minHeight: 640, frame: false, title: V.name, backgroundColor: V.bg, show: false,
    icon: path.join(__dirname, V.icon),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });
  launcher.loadURL(base + "/launcher");
  launcher.once("ready-to-show", () => launcher.show());
  launcher.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  launcher.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); shell.openExternal(url); } });
  launcher.on("closed", () => (launcher = null));
}
// One window at a time: the launcher hands over to the control room, and Help > Launcher hands back.
const controlUrl = id => base + "/" + (id ? "?event=" + encodeURIComponent(id) : ""); // Quick Join opens straight into one event
function openControlRoom(id) { if (win) { win.loadURL(controlUrl(id)); if (win.isMinimized()) win.restore(); win.focus(); } else createWindow(id); if (launcher) launcher.close(); }
function openLauncher() { if (launcher) { if (launcher.isMinimized()) launcher.restore(); launcher.focus(); } else createLauncher(); if (win) win.close(); }
const fromLauncher = fn => (e, ...a) => (launcher && e.sender === launcher.webContents ? fn(...a) : undefined); // only our own launcher page may call these
function setupLauncherIpc() {
  const on = (ch, fn) => ipcMain.handle(ch, fromLauncher(fn));
  on("launcher:state", () => ({ version: app.getVersion(), packaged: app.isPackaged, profile: LS.profile, prefs: LS.prefs, update: upd }));
  on("launcher:signin", p => {
    const name = String((p && p.name) || "").trim().slice(0, 60), email = String((p && p.email) || "").trim().slice(0, 120);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter your name and a valid email." };
    LS.profile = { name, email }; saveLauncher();
    return { ok: true, profile: LS.profile };
  });
  on("launcher:signout", () => { LS.profile = null; saveLauncher(); return { ok: true }; });
  on("launcher:check", () => checkNow());
  on("launcher:download", () => downloadUpdate());
  on("launcher:install", () => installUpdate());
  on("launcher:control-room", async id => { // not before this copy is activated
    try { const j = await (await fetch(base + "/api/license")).json(); if (j.enforced && !j.licensed) return { ok: false, error: j.message || "Enter your code first." }; } catch { /* the server answers for itself */ }
    openControlRoom(id); return { ok: true };
  });
  on("launcher:open-data", () => shell.openPath(process.env.SAINTS_DATA));
  on("win:min", () => launcher && launcher.minimize());
  on("win:max", () => launcher && (launcher.isMaximized() ? launcher.unmaximize() : launcher.maximize()));
  on("win:close", () => launcher && launcher.close());
}

// The control room's update pop-up: read the state, and "Update now" (download, then back up and install when it arrives).
let installWhenReady = false;
// Observer client: the graphics PC's overlay over this PC's game. A borderless, see-through window the size of the screen, on top,
// that never takes focus or clicks, so the observer keeps playing underneath. Only the graphics PC this copy is paired with can be shown.
let hudWin = null;
function hudAllowed(url) {
  try { const o = (dbOf() || {}).settings && dbOf().settings.observer, g = o && o.gfx ? new URL(o.gfx) : null, u = new URL(url);
    return !!(g && u.protocol === g.protocol && u.host === g.host && u.pathname === "/overlay"); } catch { return false; }
}
function showHudOnGame(url) {
  if (!hudAllowed(url)) return { ok: false, error: "That isn't the paired graphics PC's overlay." };
  if (hudWin) { hudWin.close(); hudWin = null; }
  const d = require("electron").screen.getPrimaryDisplay();
  hudWin = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, transparent: true, frame: false, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false, backgroundColor: "#00000000", webPreferences: { contextIsolation: true, sandbox: true } });
  hudWin.setIgnoreMouseEvents(true); hudWin.setAlwaysOnTop(true, "screen-saver"); hudWin.loadURL(url);
  hudWin.once("ready-to-show", () => hudWin && hudWin.showInactive()); hudWin.on("closed", () => { hudWin = null; });
  return { ok: true };
}
function setupControlIpc() {
  const on = (ch, fn) => ipcMain.handle(ch, (e, ...a) => (win && e.sender === win.webContents ? fn(...a) : undefined)); // only our own control room page
  on("app:update-state", () => ({ version: app.getVersion(), update: upd }));
  on("app:hud-show", url => showHudOnGame(String(url || "")));
  on("app:hud-hide", () => { if (hudWin) { hudWin.close(); hudWin = null; } return { ok: true }; });
  on("app:hud-state", () => ({ on: !!hudWin }));
  on("app:update-check", () => { if (!updater) return { ok: false, error: "Updates only work in the installed app." }; if ([...BUSY, "available"].includes(upd.state)) return { ok: true, state: upd.state };
    lastCheck = Date.now(); updater.checkForUpdates().catch(() => {}); return { ok: true, state: "checking" }; });
  on("app:update-go", () => {
    if (upd.state === "ready") return installUpdate();
    if (upd.state === "downloading") { installWhenReady = true; return { ok: true }; }
    if (upd.state === "error") { checkNow(); return { ok: true }; } // check again; the pop-up comes back when GitHub answers
    const r = downloadUpdate(); if (r.ok) installWhenReady = true; return r;
  });
}
function createWindow(id) {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    title: V.name + " Control Room", backgroundColor: V.bg, show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, V.icon),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "control-preload.js") },
  });
  win.loadURL(controlUrl(id));
  win.once("ready-to-show", () => { win.show(); quietCheck(60 * 1000); }); // opening the control room looks for an update
  win.on("focus", () => quietCheck()); // and coming back to it (at most every 5 minutes)
  win.on("page-title-updated", e => e.preventDefault()); // keep the app name in the title bar
  // links to other sites open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(base)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); shell.openExternal(url); } });
  win.on("closed", () => (win = null));
}

function overlayPreview() {
  const w = new BrowserWindow({ width: 1280, height: 720, title: "Overlay preview", backgroundColor: "#000", autoHideMenuBar: true });
  w.loadURL(base + "/overlay?scene=auto&bg=pitch");
}

/* ---- auto-update from GitHub Releases (installed copies only) ---- */
// Same two-step flow as Albion Economics: an update is only detected and announced, the user starts the download, and installing
// takes a backup of the data folder first (no backup, no install). electron-updater checks the download against the sha512 in
// latest.yml and rejects a file that does not match.
// Progress and results show in the launcher; a dialog is only used when the launcher has been closed.
let updater = null, manualCheck = false;
const BUSY = ["downloading", "ready", "installing"];
function setupUpdates() {
  if (!app.isPackaged) { setUpdate({ state: "source" }); return; }
  ({ autoUpdater: updater } = require("electron-updater"));
  // Updates come from the public releases of McJanrey/Chud-Hud-Manager (package.json "publish"), so no token is needed.
  if (V.id) updater.channel = V.id; // an edition updates only from its own releases (latest-<id>.yml), never from the standard app's
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false; // never install behind the user's back, a restart takes the OBS overlay offline
  updater.on("checking-for-update", () => setUpdate({ state: "checking", error: "" }));
  updater.on("update-available", info => {
    if (BUSY.includes(upd.state)) return;
    setUpdate({ state: "available", version: info.version, percent: 0, error: "", notes: notesOf(info) }); // the control room shows its own pop-up
  });
  updater.on("download-progress", p => setUpdate({ state: "downloading", percent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", info => {
    setUpdate({ state: "ready", version: info.version });
    if (installWhenReady) { installWhenReady = false; installUpdate(); } // "Update now" in the pop-up: install as soon as it is downloaded
  });
  updater.on("update-not-available", () => { setUpdate({ state: "none" }); manualCheck = false; });
  updater.on("error", err => {
    const why = String((err && err.message) || err).split("\n")[0].slice(0, 200), offline = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::ERR/i.test(why);
    installWhenReady = false;
    setUpdate({ state: "error", error: offline ? "No internet connection to GitHub." : why });
    if (manualCheck && !launcher) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates.", detail: String(err && err.message || err) });
    manualCheck = false;
  });
  lastCheck = Date.now(); updater.checkForUpdates().catch(() => {});
  setInterval(() => quietCheck(0), 10 * 60 * 1000); // every 10 minutes, so a release shows up while the app stays open
}
// GitHub release notes as plain text (electron-updater gives the release body as HTML, or a list of notes)
function notesOf(info) {
  const n = info && info.releaseNotes, raw = Array.isArray(n) ? n.map(x => (x && x.note) || "").join("\n") : String(n || "");
  return raw.replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
}
function downloadUpdate() {
  if (!updater || upd.state !== "available") return { ok: false, error: "No update to download." };
  setUpdate({ state: "downloading", percent: 0, error: "" });
  updater.downloadUpdate().catch(() => {}); // failures arrive through the "error" event
  return { ok: true };
}
// Copies db.json, launcher.json and uploads/ into <data>/backups/pre-update-<version>-<time>/ and keeps the newest 5.
// Throws if anything cannot be copied, which stops the install with the data untouched.
function backupBeforeUpdate() {
  const data = process.env.SAINTS_DATA, root = path.join(data, "backups");
  const dir = path.join(root, `pre-update-v${app.getVersion()}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["db.json", "launcher.json"]) {
    const src = path.join(data, f);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, f);
    fs.copyFileSync(src, dst);
    if (fs.statSync(dst).size !== fs.statSync(src).size) throw new Error(`backup of ${f} is incomplete`);
  }
  if (fs.existsSync(path.join(data, "uploads"))) fs.cpSync(path.join(data, "uploads"), path.join(dir, "uploads"), { recursive: true });
  for (const n of fs.readdirSync(root).filter(n => n.startsWith("pre-update-")).sort().slice(0, -5)) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  return dir;
}
function installUpdate() {
  if (!updater || upd.state !== "ready") return { ok: false, error: "No downloaded update." };
  try { backupBeforeUpdate(); }
  catch (e) {
    const error = `Update not installed: backup failed (${e.message}). Your data is untouched. Free some disk space and try again.`;
    setUpdate({ error }); return { ok: false, error };
  }
  setUpdate({ state: "installing" });
  setImmediate(() => updater.quitAndInstall(true, true)); // silent installer, relaunches the app afterwards
  return { ok: true };
}
// a background check: skipped while an update is downloading or waiting, and at most once per `gap` ms
let lastCheck = 0;
function quietCheck(gap = 5 * 60 * 1000) {
  if (!updater || [...BUSY, "available", "checking"].includes(upd.state) || Date.now() - lastCheck < gap) return;
  lastCheck = Date.now(); updater.checkForUpdates().catch(() => {});
}
function checkNow() {
  if (!updater) { if (!launcher) dialog.showMessageBox(win, { type: "info", message: "Updates only work in the installed app.", detail: "You're running from source. Use git pull to update." }); return; }
  if ([...BUSY, "available"].includes(upd.state)) return;
  manualCheck = true; updater.checkForUpdates().catch(() => {});
}

function buildMenu() {
  menuSig = eventsList().map(e => e.id + e.name + e.game).join("|");
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "Copy overlay link", submenu: overlayItems() },
      { label: "Open overlay preview window", click: overlayPreview },
      { label: "Open data folder", click: () => shell.openPath(process.env.SAINTS_DATA) },
      { type: "separator" }, { role: "quit" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "toggleDevTools" }] },
    { label: "Help", submenu: [
      { label: "Launcher", click: openLauncher },
      { label: "Check for updates", click: checkNow },
      { label: `Version ${app.getVersion()}`, enabled: false }] },
  ]));
}

// A startup error used to vanish: it threw inside this promise, nothing caught it, and the app sat in Task Manager with no window.
// Now it shows the error, saves it next to the data (startup-error.log) and quits.
function startupFailed(err) {
  const text = String((err && err.stack) || err);
  try { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(path.join(app.getPath("userData"), "startup-error.log"), new Date().toISOString() + "\n" + text + "\n"); } catch { /* read-only folder */ }
  try { dialog.showErrorBox(V.name + " can't start", text.slice(0, 1500) + "\n\nThis was also saved to startup-error.log in " + app.getPath("userData") + "."); } catch { /* no display */ }
  app.exit(1);
}
app.whenReady().then(() => {
  const { server, PORT, setOcrProvider, getDb } = require("./server.js");
  dbOf = getDb;
  setOcrProvider(require("./ocr.js"));
  base = `http://127.0.0.1:${PORT}`;
  loadLauncher();
  setupLauncherIpc(); setupControlIpc();
  buildMenu();
  setInterval(() => { if (menuSig !== eventsList().map(e => e.id + e.name + e.game).join("|")) buildMenu(); }, 4000); // the File menu lists each event's overlay link
  setupUpdates();
  // F9 flips the League bottom board between the lane board and the teamfight strip, even while OBS has focus
  if (!globalShortcut.register("F9", () => { fetch(base + "/api/lol/panel", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {}); }))
    console.log("F9 is already taken by another program, so the teamfight hotkey is unavailable. Use the dashboard button.");
  const start = () => createLauncher(); // the launcher is the only window at start; Open Control Room replaces it
  if (server.listening) start(); else server.once("listening", start);
  server.once("error", err => {
    dialog.showErrorBox(V.name + " can't start",
      err.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Close any other copy of ${V.name} (or START.bat) and try again.` : err.message);
    app.quit();
  });
}).catch(startupFailed);
app.on("second-instance", () => { const w = launcher || win; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else if (app.isReady()) createLauncher(); }); // opening Chud Hud again always shows a window, even if the running copy had none
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
