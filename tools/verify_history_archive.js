"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app", "history_archive.html"), "utf8");
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
if (scripts.length < 2) {
  throw new Error("historical archive inline scripts are missing");
}
new Function(scripts[scripts.length - 1][1]);
console.log("Historical archive inline JavaScript passed.");
