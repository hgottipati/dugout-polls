#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(root, "scripts/og-card.html");
const shot = path.join(root, "scripts/og-assets/og-raw.png");
const outJpg = path.join(root, "public/og.jpg");
const outIcon = path.join(root, "public/apple-touch-icon.png");
const baseball = path.join(root, "scripts/og-assets/baseball.jpg");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

await run(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  `--screenshot=${shot}`,
  "--virtual-time-budget=4000",
  `file://${html}`,
]);

await sharp(shot)
  .resize(1200, 630, { fit: "cover" })
  .jpeg({ quality: 84, mozjpeg: true })
  .toFile(outJpg);

await sharp(baseball)
  .resize(180, 180, { fit: "cover", position: "centre" })
  .png()
  .toFile(outIcon);

const info = await sharp(outJpg).metadata();
console.log(`wrote ${outJpg} (${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} KB)`);
console.log(`wrote ${outIcon}`);
