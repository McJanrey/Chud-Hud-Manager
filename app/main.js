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
function setUpdate(patch) { upd = Object.assign({}, upd, patch); if (launcher) launcher.webContents.send("launcher:update", upd); }

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
  on("launcher:control-room", id => openControlRoom(id));
  on("launcher:quickjoin", ids => { LS.prefs.quickJoin = Array.isArray(ids) ? ids.map(String).slice(0, 12) : []; saveLauncher(); return LS.prefs.quickJoin; });
  on("launcher:copy-overlay", id => { const u = overlayUrl(id); clipboard.writeText(u); return u; });
  on("launcher:open-data", () => shell.openPath(process.env.SAINTS_DATA));
  on("win:min", () => launcher && launcher.minimize());
  on("win:max", () => launcher && (launcher.isMaximized() ? launcher.unmaximize() : launcher.maximize()));
  on("win:close", () => launcher && launcher.close());
}

function createWindow(id) {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    title: V.name + " Control Room", backgroundColor: V.bg, show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, V.icon),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(controlUrl(id));
  win.once("ready-to-show", () => win.show());
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
  if (V.id) updater.channel = V.id; // an edition updates only from its own releases (latest-<id>.yml), never from the standard app's
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false; // never install behind the user's back, a restart takes the OBS overlay offline
  updater.on("checking-for-update", () => setUpdate({ state: "checking", error: "" }));
  updater.on("update-available", info => {
    if (BUSY.includes(upd.state)) return;
    setUpdate({ state: "available", version: info.version, percent: 0, error: "" });
    if (!launcher && win) dialog.showMessageBox(win, { type: "info", buttons: ["Download", "Later"], defaultId: 0, cancelId: 1,
      title: "Update available", message: `${V.name} ${info.version} is available.`, detail: "Downloading does not restart anything. You choose when to install it." })
      .then(r => { if (r.response === 0) downloadUpdate(); });
  });
  updater.on("download-progress", p => setUpdate({ state: "downloading", percent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", info => {
    setUpdate({ state: "ready", version: info.version });
    if (!launcher && win) dialog.showMessageBox(win, { type: "info", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
      title: "Update ready", message: `${V.name} ${info.version} is ready to install.`,
      detail: "Your events and settings are backed up first. Restarting briefly takes the overlay offline in OBS." })
      .then(r => { if (r.response === 0) installUpdate(); });
  });
  updater.on("update-not-available", () => { setUpdate({ state: "none" }); manualCheck = false; });
  updater.on("error", err => {
    setUpdate({ state: "error", error: String((err && err.message) || err).split("\n")[0].slice(0, 200) });
    if (manualCheck && !launcher) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates.", detail: String(err && err.message || err) });
    manualCheck = false;
  });
  updater.checkForUpdates().catch(() => {});
  setInterval(() => { if (![...BUSY, "available"].includes(upd.state)) updater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000);
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

app.whenReady().then(() => {
  const { server, PORT, setOcrProvider, getDb } = require("./server.js");
  dbOf = getDb;
  setOcrProvider(require("./ocr.js"));
  base = `http://127.0.0.1:${PORT}`;
  loadLauncher();
  setupLauncherIpc();
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
});
app.on("second-instance", () => { const w = launcher || win; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
