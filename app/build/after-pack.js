// electron-builder hook: stamp the icon and product details onto the exe (Chud Hud.exe, or Chud Hud LOTD.exe for that edition).
// (electron-builder's own resource editing needs symlink rights that a normal Windows account doesn't have.)
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const { rcedit } = await import("rcedit");
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const lotd = ((context.packager.config.extraMetadata || {}).variant) === "lotd", name = context.packager.appInfo.productName;
  await rcedit(exe, {
    icon: path.join(__dirname, lotd ? "lotd" : ".", "icon.ico"),
    "version-string": { ProductName: name, FileDescription: name, CompanyName: "St. Clair Saints Broadcast", OriginalFilename: name + ".exe" },
  });
};
