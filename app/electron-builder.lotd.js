// Builds Chud Hud LOTD (Lan of the Dead), the Halloween edition: npm run dist:lotd (or release:lotd to publish).
// Same code as the standard app. It installs next to it (own app id, name, data folder, ports, icon) and updates from its own
// releases: the release carries latest-lotd.yml next to the standard app's latest.yml, so neither app ever offers the other's installer.
const base = require("./package.json").build;

module.exports = Object.assign({}, base, {
  appId: "ca.stclair.chudhudlotd",
  productName: "Chud Hud LOTD",
  extraMetadata: { variant: "lotd" },
  directories: { output: "dist-lotd", buildResources: "build" },
  files: base.files.concat(["build/lotd/icon.png"]),
  win: { icon: "build/lotd/icon.ico", signAndEditExecutable: false, target: ["nsis"] },
  publish: [Object.assign({}, base.publish[0], { channel: "lotd" })],
  nsis: Object.assign({}, base.nsis, {
    artifactName: "ChudHudLOTD-Setup-${version}.exe",
    installerIcon: "build/lotd/icon.ico", uninstallerIcon: "build/lotd/icon.ico", installerHeaderIcon: "build/lotd/icon.ico",
    shortcutName: "Chud Hud LOTD",
  }),
});
