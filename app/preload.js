// Bridge between the launcher window and the app: only these calls are exposed to the page.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const call = ch => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld("saints", {
  state: call("launcher:state"),                 // { version, packaged, profile, prefs, update }
  signIn: call("launcher:signin"),               // { name, email }
  signOut: call("launcher:signout"),
  checkUpdates: call("launcher:check"),
  downloadUpdate: call("launcher:download"),     // user starts the download of an announced update
  installUpdate: call("launcher:install"),       // backs up the data folder, then installs; { ok, error }
  openControlRoom: call("launcher:control-room"),   // (eventId?) opens the control room, straight into that event if given
  setQuickJoin: call("launcher:quickjoin"),         // (eventIds) the events pinned to Quick Join
  copyOverlay: call("launcher:copy-overlay"),
  openData: call("launcher:open-data"),
  win: { min: call("win:min"), max: call("win:max"), close: call("win:close") },
  onUpdate: cb => ipcRenderer.on("launcher:update", (_e, u) => cb(u)),
});
