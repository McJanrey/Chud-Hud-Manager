// electron-builder hook: stamp the Saints emblem and product details onto Saints HUD.exe.
// (electron-builder's own resource editing needs symlink rights that a normal Windows account doesn't have.)
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const { rcedit } = await import("rcedit");
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await rcedit(exe, {
    icon: path.join(__dirname, "icon.ico"),
    "version-string": { ProductName: "Saints HUD", FileDescription: "Saints HUD", CompanyName: "St. Clair Saints Broadcast", OriginalFilename: "Saints HUD.exe" },
  });
};
