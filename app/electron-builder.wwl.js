// Builds Chud Hud WWL (Winter Wonder-LAN), the winter edition: npm run dist:wwl (or release:wwl to publish).
// Same code as the standard app. It installs next to it (own app id, name, data folder, ports, icon) and updates from its own
// releases: the release carries latest-wwl.yml next to the standard app's latest.yml, so neither app ever offers the other's installer.
const base = require("./package.json").build;

module.exports = Object.assign({}, base, {
  appId: "ca.stclair.chudhudwwl",
  productName: "Chud Hud WWL",
  extraMetadata: { variant: "wwl" },
  directories: { output: "dist-wwl", buildResources: "build" },
  files: base.files.concat(["build/wwl/icon.png"]),
  win: { icon: "build/wwl/icon.ico", signAndEditExecutable: false, target: ["nsis"] },
  publish: [Object.assign({}, base.publish[0], { channel: "wwl" })],
  nsis: Object.assign({}, base.nsis, {
    artifactName: "ChudHudWWL-Setup-${version}.exe",
    installerIcon: "build/wwl/icon.ico", uninstallerIcon: "build/wwl/icon.ico", installerHeaderIcon: "build/wwl/icon.ico",
    shortcutName: "Chud Hud WWL",
  }),
});
