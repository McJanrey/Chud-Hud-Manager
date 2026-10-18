"use strict";
// Product variants. The same code builds more than one app: the standard Chud Hud, and Chud Hud LOTD (Lan of the Dead),
// a Halloween edition that installs next to it with its own name, data folder, ports, icon and update channel.
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
    // the overlay's greens and gold become a haunted purple and pumpkin orange when its stylesheet is served
    colors: [
      [/rgba\(5,\s*24,\s*17/g, "rgba(16,6,26"], [/rgba\(2,\s*14,\s*10/g, "rgba(9,3,15"], [/rgba\(8,\s*36,\s*25/g, "rgba(34,12,48"],
      [/rgba\(10,\s*62,\s*40/g, "rgba(78,24,104"], [/rgba\(253,\s*200,\s*47/g, "rgba(255,122,26"], [/rgba\(255,\s*200,\s*60/g, "rgba(255,138,43"],
      [/#07120e/gi, "#0d0614"], [/#1a2a22/gi, "#2a1838"], [/#fdc82f/gi, "#ff7a1a"], [/#ffc531/gi, "#ff8a2b"], [/#ffe08a/gi, "#ffb869"],
      [/#9db3a8/gi, "#b7a6c9"], [/#cbd6cf/gi, "#ddd0ea"], [/#b9c9bf/gi, "#cbbdd9"], [/#7be3a3/gi, "#8cff4a"],
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
        s = s.replace(/Chud Hud(?! LOTD)/g, name).replace("<small>BROADCAST</small>", `<small>${v.tagline}</small>`);
        s = s.replace(/<html(\s|>)/, `<html data-variant="${v.id}"$1`);
      }
      const themed = /(^|[\\/])(app|launcher|cam)\.html$/.test(String(file || ""));
      return !themed || s.includes("/theme.css") ? s : s.replace("</head>", `<link rel="stylesheet" href="/theme.css">\n</head>`);
    },
    /* the overlay stylesheet as served */
    hudCss(text) { return v ? v.colors.reduce((s, [re, to]) => s.replace(re, to), String(text)) : String(text); },
  };
  return out;
}

module.exports = Object.assign(pick(), { forId, VARIANTS });
