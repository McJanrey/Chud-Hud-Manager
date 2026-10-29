"use strict";
// Bridge between the control room and the app: only the update pop-up's calls are exposed to the page.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("chudUpdate", {
  state: () => ipcRenderer.invoke("app:update-state"),   // { version (running), update: { state, version, percent, error, notes } }
  go: () => ipcRenderer.invoke("app:update-go"),
  check: () => ipcRenderer.invoke("app:update-check"),       // look for an update now (the sidebar button)          // download, back up the data folder, install and restart
  onUpdate: cb => ipcRenderer.on("app:update", (_e, u) => cb(u)),
});
// the observer client: the graphics PC's HUD drawn over this PC's game, in a see-through window that lets clicks through
contextBridge.exposeInMainWorld("chudObserver", {
  showHud: url => ipcRenderer.invoke("app:hud-show", url),
  hideHud: () => ipcRenderer.invoke("app:hud-hide"),
  hudState: () => ipcRenderer.invoke("app:hud-state"),
});
