"use strict";
// Bridge between the control room and the app: only the update pop-up's calls are exposed to the page.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("chudUpdate", {
  state: () => ipcRenderer.invoke("app:update-state"),   // { version (running), update: { state, version, percent, error, notes } }
  go: () => ipcRenderer.invoke("app:update-go"),          // download, back up the data folder, install and restart
  onUpdate: cb => ipcRenderer.on("app:update", (_e, u) => cb(u)),
});
