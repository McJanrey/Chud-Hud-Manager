"use strict";
// Product variants. The same code builds more than one app: the standard Chud Hud, and Chud Hud LOTD (Lan of the Dead),
// a Halloween edition (and Chud Hud WWL, Winter Wonder-LAN, a winter one) that installs next to it with its own name, data folder, ports, icon and update channel.
//
// Pick one with --variant=lotd, the CHUDHUD_VARIANT environment variable, or the "variant" field that the LOTD build writes
// into package.json. Anything else is the standard app.
const pkg = require("./package.json");

const VARIANTS = {
  lotd: {
    id: "lotd",
    name: "Chud Hud LOTD",
    tagline: "LAN OF THE DEAD",
    appId: "ca.stclair.chudhudlotd",
    dataDir: "Chud Hud LOTD",
    port: 7787, camPort: 7788,          // next to the standard app's 7777 and 7778, so both can run at once
    icon: "build/lotd/icon.png",
    bg: "#0d0614",
    // the caster nameplate is MJ's own artwork (brand/lotd/nameplate.png, text removed) with the name and role set over it in its lettering
    css: `@font-face{font-family:"Montserrat";font-weight:800;font-display:swap;src:url(/fonts/montserrat-latin-800.woff2) format("woff2")}
.np{width:380px;height:57px}.np .sh{display:none}
.np .bd{position:absolute;inset:0;display:block;padding:0;border:0;box-shadow:none;clip-path:none;background:url(/brand/lotd/nameplate.png) 0 0/100% 100% no-repeat}
.np b,.np small{position:absolute;left:28.3%;font:800 15.5px/1 "Montserrat",sans-serif;letter-spacing:.01em;color:#f89048}
.np b{top:7px;width:56%}.np small{top:29px;width:44%}`,
    // the overlay's greens and gold become a haunted purple and pumpkin orange when its stylesheet is served
    colors: [
      [/rgba\(5,\s*24,\s*17/g, "rgba(16,6,26"], [/rgba\(2,\s*14,\s*10/g, "rgba(9,3,15"], [/rgba\(8,\s*36,\s*25/g, "rgba(34,12,48"],
      [/rgba\(10,\s*62,\s*40/g, "rgba(78,24,104"], [/rgba\(253,\s*200,\s*47/g, "rgba(225,135,61"], [/rgba\(255,\s*200,\s*60/g, "rgba(240,162,101"],
      [/#07120e/gi, "#0d0614"], [/#1a2a22/gi, "#2a1838"], [/#fdc82f/gi, "#e1873d"], [/#ffc531/gi, "#e8985a"], [/#ffe08a/gi, "#f0b585"],
      [/#9db3a8/gi, "#b7a6c9"], [/#cbd6cf/gi, "#ddd0ea"], [/#b9c9bf/gi, "#cbbdd9"], [/#7be3a3/gi, "#65d589"], [/#b48cff/gi, "#8250f0"], [/#c8a2ff/gi, "#9b78f4"], [/#d8c6ff/gi, "#b9a2f8"],
    ],
  },
  wwl: {
    id: "wwl",
    name: "Chud Hud WWL",
    tagline: "WINTER WONDER-LAN",
    appId: "ca.stclair.chudhudwwl",
    dataDir: "Chud Hud WWL",
    port: 7767, camPort: 7768,          // next to the standard app and LOTD, so all three can run at once
    icon: "build/wwl/icon.png",
    bg: "#001e3c",
    /* Winter Wonder-LAN brand: navy #001e3c, blues #57a5fc and #98c6ff, grey #e9e9e9, red #ff6060, green #74db83.
       Every scene's golds and dark greens become the winter blues and navy when the overlay stylesheet is served. */
    colors: [
      // the dark panels: green-black becomes navy
      [/rgba\(5,\s*24,\s*17/g, "rgba(0,30,60"], [/rgba\(2,\s*14,\s*10/g, "rgba(0,18,38"], [/rgba\(8,\s*36,\s*25/g, "rgba(8,46,88"], [/rgba\(10,\s*62,\s*40/g, "rgba(20,70,125"],
      [/#07120e/gi, "#001e3c"], [/#1a2a22/gi, "#12335a"],
      // gold becomes the winter blues (bright, light, deep)
      [/rgba\(253,\s*200,\s*47/g, "rgba(87,165,252"], [/rgba\(255,\s*200,\s*60/g, "rgba(152,198,255"],
      [/#fdc82f/gi, "#57a5fc"], [/#ffc531/gi, "#6cb1fd"], [/#f0b030/gi, "#57a5fc"], [/#ffe08a/gi, "#c3dcff"], [/#f6d58a/gi, "#c3dcff"],
      [/#d8c793/gi, "#98c6ff"], [/#c9b27c/gi, "#98c6ff"], [/#c8aa6e/gi, "#98c6ff"], [/#c9a64b/gi, "#3d86e0"], [/#c9a227/gi, "#3d86e0"], [/#c9922e/gi, "#3d86e0"], [/#e8a23a/gi, "#57a5fc"],
      // text greys and the purple accents
      [/#9db3a8/gi, "#a9c3e0"], [/#cbd6cf/gi, "#e9e9e9"], [/#b9c9bf/gi, "#d4e2f4"], [/#b48cff/gi, "#57a5fc"], [/#c8a2ff/gi, "#98c6ff"], [/#d8c6ff/gi, "#c3dcff"],
      // green and red: the brand's own
      [/#7be3a3/gi, "#74db83"], [/#ff5d5d/gi, "#ff6060"], [/#ff6a6a/gi, "#ff6060"], [/#ff8a8a/gi, "#ff8a8a"],
    ],
  },
};

function pick() {
  const arg = process.argv.find(a => a.startsWith("--variant="));
  const id = (arg ? arg.slice(10) : process.env.CHUDHUD_VARIANT !== undefined ? process.env.CHUDHUD_VARIANT : pkg.variant) || "";
  return forId(id);
}

function forId(id) {
  const v = VARIANTS[id] || null;
  const name = v ? v.name : "Chud Hud";
  const out = {
    id: v ? v.id : "", name, tagline: v ? v.tagline : "BROADCAST", appId: v ? v.appId : "ca.stclair.saintshud",
    dataDir: v ? v.dataDir : "Saints HUD",       // the standard app keeps the folder it had before it was renamed
    port: v ? v.port : 0, camPort: v ? v.camPort : 0,
    icon: v ? v.icon : "build/icon.png", bg: v ? v.bg : "#08110d",
    /* a page as served: the variant's name and tagline, a data-variant attribute and, on the control pages only (never the
       overlay, which goes to air), the theme stylesheet */
    html(text, file) {
      let s = String(text);
      if (v) {
        s = s.replace(/Chud Hud(?! (?:LOTD|WWL))/g, name).replace("<small>BROADCAST</small>", `<small>${v.tagline}</small>`);
        // the launcher's title bar and caption: CHUD <b>HUD</b> becomes CHUD <b>HUD</b> LOTD / WWL
        s = s.replace("CHUD <b>HUD</b>", "CHUD <b>HUD</b> " + name.slice(9).toUpperCase()).replace("CHUD HUD<small>", name.toUpperCase() + "<small>");
        s = s.replace(/<html(\s|>)/, `<html data-variant="${v.id}"$1`);
      }
      const themed = /(^|[\\/])(app|launcher|cam)\.html$/.test(String(file || ""));
      return !themed || s.includes("/theme.css") ? s : s.replace("</head>", `<link rel="stylesheet" href="/theme.css">\n</head>`);
    },
    /* the overlay stylesheet as served */
    hudCss(text) { return v ? v.colors.reduce((s, [re, to]) => s.replace(re, to), String(text)) + (v.css ? "\n" + v.css : "") : String(text); },
  };
  return out;
}

module.exports = Object.assign(pick(), { forId, VARIANTS });
