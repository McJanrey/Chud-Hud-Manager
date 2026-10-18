# Rebuilds an edition's logo and icons from one image (any PNG, any size, transparent background works best).
#   powershell -File app\tools\make-icons.ps1 -Source "C:\path\logo.png" -Edition lotd
# Writes: app\public\brand\lotd\chud-hud.png (the in-app and overlay logo), app\build\lotd\icon.png and icon.ico (window, installer, exe).
# Use -Edition standard for the standard app (app\public\brand\chud-hud.png, app\build\icon.*).
param([Parameter(Mandatory = $true)][string]$Source, [ValidateSet("lotd", "standard")][string]$Edition = "lotd")
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"
$app = Join-Path (Split-Path -Parent $PSScriptRoot) "."
if ($Edition -eq "lotd") { $logoDir = "$app\public\brand\lotd"; $iconDir = "$app\build\lotd" } else { $logoDir = "$app\public\brand"; $iconDir = "$app\build" }
New-Item -ItemType Directory -Force $logoDir, $iconDir | Out-Null
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
function Square([System.Drawing.Image]$img, [int]$size) {
  $o = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $q = [System.Drawing.Graphics]::FromImage($o); $q.Clear([System.Drawing.Color]::Transparent)
  $q.InterpolationMode = "HighQualityBicubic"; $q.SmoothingMode = "HighQuality"; $q.PixelOffsetMode = "HighQuality"
  $k = [Math]::Min($size / $img.Width, $size / $img.Height); $w = [int]($img.Width * $k); $h = [int]($img.Height * $k)
  $q.DrawImage($img, [int](($size - $w) / 2), [int](($size - $h) / 2), $w, $h); $q.Dispose(); return $o
}
function PngBytes($b) { $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); return ,$ms.ToArray() }
$big = Square $src 512
$big.Save("$logoDir\chud-hud.png", [System.Drawing.Imaging.ImageFormat]::Png)
$big.Save("$iconDir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$sizes = 256, 128, 64, 48, 32, 24, 16
$datas = @(); foreach ($s in $sizes) { $datas += ,(PngBytes (Square $src $s)) }
$ms = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $d = $datas[$i]; $b8 = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$b8); $bw.Write([byte]$b8); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$d.Length); $bw.Write([UInt32]$offset); $offset += $d.Length
}
foreach ($d in $datas) { $bw.Write($d) }
$bw.Flush(); [System.IO.File]::WriteAllBytes("$iconDir\icon.ico", $ms.ToArray())
$src.Dispose()
"Wrote $logoDir\chud-hud.png and $iconDir\icon.png / icon.ico"
