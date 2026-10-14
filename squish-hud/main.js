// Desktop shell: runs the Squish server inside the app and shows the control room in its own window.
// OBS still reads the overlay from http://localhost:7777/overlay while the app is open.
"use strict";
const { app, BrowserWindow, Menu, shell, dialog, clipboard } = require("electron");
const path = require("path");

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

process.env.SQUISH_DATA = process.env.SQUISH_DATA || path.join(app.getPath("userData"), "data");
let win = null, base = "";

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    title: "Saints HUD Control Room", backgroundColor: "#0d0e11", show: false, autoHideMenuBar: true,
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
let updater = null, manualCheck = false;
function setupUpdates() {
  if (!app.isPackaged) return;
  ({ autoUpdater: updater } = require("electron-updater"));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-downloaded", info => {
    dialog.showMessageBox(win, { type: "info", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
      title: "Update ready", message: `Saints HUD ${info.version} is ready to install.`,
      detail: "Restart now to update, or it will install the next time you close the app. Restarting briefly takes the overlay offline in OBS." })
      .then(r => { if (r.response === 0) updater.quitAndInstall(); });
  });
  updater.on("update-not-available", () => {
    if (manualCheck) dialog.showMessageBox(win, { type: "info", message: `You're on the latest version (${app.getVersion()}).` });
    manualCheck = false;
  });
  updater.on("error", err => {
    if (manualCheck) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates.", detail: String(err && err.message || err) });
    manualCheck = false;
  });
  updater.checkForUpdates().catch(() => {});
  setInterval(() => updater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
}
function checkNow() {
  if (!updater) return dialog.showMessageBox(win, { type: "info", message: "Updates only work in the installed app.", detail: "You're running from source. Use git pull to update." });
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
      { label: "Check for updates", click: checkNow },
      { label: `Version ${app.getVersion()}`, enabled: false }] },
  ]));
}

app.whenReady().then(() => {
  const { server, PORT } = require("./server.js");
  base = `http://127.0.0.1:${PORT}`;
  buildMenu();
  setupUpdates();
  if (server.listening) createWindow(); else server.once("listening", createWindow);
  server.once("error", err => {
    dialog.showErrorBox("Saints HUD can't start",
      err.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Close any other copy of Saints HUD (or START.bat) and try again.` : err.message);
    app.quit();
  });
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
