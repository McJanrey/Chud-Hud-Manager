// Desktop shell: runs the Squish server inside the app and shows the control room in its own window.
// OBS still reads the overlay from http://localhost:7777/overlay while the app is open.
"use strict";
const { app, BrowserWindow, Menu, shell, dialog, clipboard, globalShortcut, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// `Saints HUD.exe --ocr-selftest` checks that screen capture and text reading work on this PC.
if (process.argv.includes("--ocr-selftest")) { require("./test/ocr-selftest.js"); return; }
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

process.env.SQUISH_DATA = process.env.SQUISH_DATA || path.join(app.getPath("userData"), "data");
let win = null, launcher = null, base = "";

/* ---- launcher: sign-in, update status and the way into the control room ---- */
// There is no account server: signing in saves a local profile (name and email) on this PC. Preferences live next to it.
const LAUNCHER_FILE = () => path.join(process.env.SQUISH_DATA, "launcher.json");
let LS = { profile: null, prefs: { autoOpen: true } };
function loadLauncher() { try { const j = JSON.parse(fs.readFileSync(LAUNCHER_FILE(), "utf8")); LS = { profile: j.profile || null, prefs: Object.assign({ autoOpen: true }, j.prefs) }; } catch { /* first run */ } }
function saveLauncher() { try { fs.mkdirSync(path.dirname(LAUNCHER_FILE()), { recursive: true }); fs.writeFileSync(LAUNCHER_FILE(), JSON.stringify(LS, null, 2)); } catch { /* read-only folder: keep going */ } }
// state: source (running from source) | idle | checking | none | downloading | ready | error
let upd = { state: "idle", version: "", percent: 0, error: "" };
function setUpdate(patch) { upd = Object.assign({}, upd, patch); if (launcher) launcher.webContents.send("launcher:update", upd); }

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1100, height: 770, minWidth: 900, minHeight: 640, frame: false, title: "Saints HUD", backgroundColor: "#08110d", show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });
  launcher.loadURL(base + "/launcher");
  launcher.once("ready-to-show", () => launcher.show());
  launcher.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  launcher.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); shell.openExternal(url); } });
  launcher.on("closed", () => (launcher = null));
}
function openControlRoom() { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } else createWindow(); }
const fromLauncher = fn => (e, ...a) => (launcher && e.sender === launcher.webContents ? fn(...a) : undefined); // only our own launcher page may call these
function setupLauncherIpc() {
  const on = (ch, fn) => ipcMain.handle(ch, fromLauncher(fn));
  on("launcher:state", () => ({ version: app.getVersion(), packaged: app.isPackaged, profile: LS.profile, prefs: LS.prefs, update: upd }));
  on("launcher:signin", p => {
    const name = String((p && p.name) || "").trim().slice(0, 60), email = String((p && p.email) || "").trim().slice(0, 120);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter your name and a valid email." };
    LS.profile = { name, email }; saveLauncher();
    if (LS.prefs.autoOpen) openControlRoom();
    return { ok: true, profile: LS.profile };
  });
  on("launcher:signout", () => { LS.profile = null; saveLauncher(); return { ok: true }; });
  on("launcher:pref", (k, v) => { if (k === "autoOpen") { LS.prefs.autoOpen = !!v; saveLauncher(); } return LS.prefs; });
  on("launcher:check", () => checkNow());
  on("launcher:install", () => { if (updater && upd.state === "ready") updater.quitAndInstall(); });
  on("launcher:control-room", () => openControlRoom());
  on("launcher:copy-overlay", () => { clipboard.writeText(base + "/overlay?scene=auto"); return base + "/overlay?scene=auto"; });
  on("launcher:open-data", () => shell.openPath(process.env.SQUISH_DATA));
  on("win:min", () => launcher && launcher.minimize());
  on("win:max", () => launcher && (launcher.isMaximized() ? launcher.unmaximize() : launcher.maximize()));
  on("win:close", () => launcher && launcher.close());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    title: "Saints HUD Control Room", backgroundColor: "#08110d", show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(base + "/");
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
// Progress and results show in the launcher; a dialog is only used when the launcher has been closed.
let updater = null, manualCheck = false;
function setupUpdates() {
  if (!app.isPackaged) { setUpdate({ state: "source" }); return; }
  ({ autoUpdater: updater } = require("electron-updater"));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("checking-for-update", () => setUpdate({ state: "checking", error: "" }));
  updater.on("update-available", info => setUpdate({ state: "downloading", version: info.version, percent: 0 }));
  updater.on("download-progress", p => setUpdate({ state: "downloading", percent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", info => {
    setUpdate({ state: "ready", version: info.version });
    if (!launcher) dialog.showMessageBox(win, { type: "info", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
      title: "Update ready", message: `Saints HUD ${info.version} is ready to install.`,
      detail: "Restart now to update, or it will install the next time you close the app. Restarting briefly takes the overlay offline in OBS." })
      .then(r => { if (r.response === 0) updater.quitAndInstall(); });
  });
  updater.on("update-not-available", () => { setUpdate({ state: "none" }); manualCheck = false; });
  updater.on("error", err => {
    setUpdate({ state: "error", error: String((err && err.message) || err).split("\n")[0].slice(0, 200) });
    if (manualCheck && !launcher) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates.", detail: String(err && err.message || err) });
    manualCheck = false;
  });
  updater.checkForUpdates().catch(() => {});
  setInterval(() => { if (!["downloading", "ready"].includes(upd.state)) updater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000);
}
function checkNow() {
  if (!updater) { if (!launcher) dialog.showMessageBox(win, { type: "info", message: "Updates only work in the installed app.", detail: "You're running from source. Use git pull to update." }); return; }
  if (["downloading", "ready"].includes(upd.state)) return;
  manualCheck = true; updater.checkForUpdates().catch(() => {});
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "Copy overlay URL for OBS", click: () => clipboard.writeText(base + "/overlay?scene=auto") },
      { label: "Open overlay preview window", click: overlayPreview },
      { label: "Open data folder", click: () => shell.openPath(process.env.SQUISH_DATA) },
      { type: "separator" }, { role: "quit" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "toggleDevTools" }] },
    { label: "Help", submenu: [
      { label: "Launcher", click: () => (launcher ? launcher.focus() : createLauncher()) },
      { label: "Check for updates", click: checkNow },
      { label: `Version ${app.getVersion()}`, enabled: false }] },
  ]));
}

app.whenReady().then(() => {
  const { server, PORT, setOcrProvider } = require("./server.js");
  setOcrProvider(require("./ocr.js"));
  base = `http://127.0.0.1:${PORT}`;
  loadLauncher();
  setupLauncherIpc();
  buildMenu();
  setupUpdates();
  // F9 flips the League bottom board between the lane board and the teamfight strip, even while OBS has focus
  if (!globalShortcut.register("F9", () => { fetch(base + "/api/lol/panel", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {}); }))
    console.log("F9 is already taken by another program, so the teamfight hotkey is unavailable. Use the dashboard button.");
  const start = () => { createLauncher(); if (LS.profile && LS.prefs.autoOpen) createWindow(); }; // signed-in users go straight to the control room
  if (server.listening) start(); else server.once("listening", start);
  server.once("error", err => {
    dialog.showErrorBox("Saints HUD can't start",
      err.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Close any other copy of Saints HUD (or START.bat) and try again.` : err.message);
    app.quit();
  });
});
app.on("second-instance", () => { const w = launcher || win; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
