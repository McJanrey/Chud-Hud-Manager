// Bridge between the launcher window and the app: only these calls are exposed to the page.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const call = ch => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld("saints", {
  state: call("launcher:state"),                 // { version, packaged, profile, prefs, update }
  signIn: call("launcher:signin"),               // { name, email }
  signOut: call("launcher:signout"),
  setPref: call("launcher:pref"),                // (key, value)
  checkUpdates: call("launcher:check"),
  installUpdate: call("launcher:install"),
  openControlRoom: call("launcher:control-room"),
  copyOverlay: call("launcher:copy-overlay"),
  openData: call("launcher:open-data"),
  win: { min: call("win:min"), max: call("win:max"), close: call("win:close") },
  onUpdate: cb => ipcRenderer.on("launcher:update", (_e, u) => cb(u)),
});
