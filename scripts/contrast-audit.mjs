import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const browserPackage = pkg.devDependencies?.playwright ? "playwright"
  : pkg.devDependencies?.["@playwright/test"] ? "@playwright/test"
  : null;

if (!browserPackage) {
  console.log("SKIP contrast audit: add Playwright as a devDependency to enable browser-computed checks.");
  process.exit(0);
}

const { chromium } = await import(browserPackage);
const server = await createServer({ server: { host: "127.0.0.1", port: 4179, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4179/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.body.classList.remove("auth-locked");
    document.querySelector("#login")?.setAttribute("hidden", "");
    document.querySelector("#pinGate")?.setAttribute("hidden", "");
    const fixture = document.createElement("section");
    fixture.id = "contrast-fixture";
    fixture.className = "view active";
    fixture.innerHTML = "<div class='card' style='padding:16px'>" +
      "<p id='audit-card-text'>Representative card text</p>" +
      "<a id='audit-link' href='#'>Representative link</a>" +
      "<button id='audit-button' class='btn btn-primary'>Action</button>" +
      "<span id='audit-ok' class='badge ok'>OK</span>" +
      "<span id='audit-warn' class='badge warn'>Warning</span>" +
      "<span id='audit-bad' class='badge bad'>Error</span>" +
      "<span id='audit-gold' class='badge gold'>Notice</span>" +
      "<input id='audit-input' type='text' placeholder='Placeholder text'></div>" +
      "<div class='table-wrap'><table><thead><tr><th>Header</th></tr></thead>" +
      "<tbody><tr><td id='audit-table-cell'>Table cell text</td></tr></tbody></table></div>";
    document.body.append(fixture);
  });
  await page.locator("#audit-input").focus();
  const report = await page.evaluate(() => {
    const rgb = value => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map(x => Number.parseFloat(x.trim()));
      if (parts.length < 3 || parts.slice(0, 3).some(x => !Number.isFinite(x))) return null;
      return parts.slice(0, 3).map(x => x / 255);
    };
    const luminance = color => {
      const channels = color.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const ratio = (a, b) => {
      if (!a || !b) return null;
      const x = luminance(a), y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const background = el => {
      for (let node = el; node; node = node.parentElement) {
        const c = getComputedStyle(node).backgroundColor;
        const v = rgb(c);
        if (v && !/rgba\([^)]*,\s*0\s*\)$/.test(c)) return v;
      }
      return rgb("rgb(255, 255, 255)");
    };
    const textCheck = (selector, name, min = 4.5) => {
      const el = document.querySelector(selector);
      if (!el) return { name, ratio: null, min, pass: false, reason: "element missing" };
      const style = getComputedStyle(el);
      const value = ratio(rgb(style.color), background(el));
      return { name, ratio: value == null ? null : Number(value.toFixed(2)), min, pass: value != null && value >= min };
    };
    const input = document.querySelector("#audit-input");
    const style = getComputedStyle(input);
    const borderRatio = ratio(rgb(style.borderTopColor), background(input));
    const focusRatio = ratio(rgb(style.outlineColor), background(input));
    return [
      textCheck("#audit-card-text", "Card text"),
      textCheck("#audit-link", "Link text"),
      textCheck("#audit-table-cell", "Table cell text"),
      textCheck("#audit-button", "Primary button text"),
      textCheck("#audit-ok", "OK badge text"),
      textCheck("#audit-warn", "Warning badge text"),
      textCheck("#audit-bad", "Error badge text"),
      textCheck("#audit-gold", "Notice badge text"),
      { name: "Input border", ratio: borderRatio == null ? null : Number(borderRatio.toFixed(2)), min: 3, pass: borderRatio != null && borderRatio >= 3 },
      { name: "Focus outline", ratio: focusRatio == null ? null : Number(focusRatio.toFixed(2)), min: 3, pass: style.outlineStyle !== "none" && focusRatio != null && focusRatio >= 3 }
    ];
  });
  console.table(report);
  const failures = report.filter(item => !item.pass);
  if (failures.length) {
    console.error("Contrast audit failed:", failures.map(item => item.name).join(", "));
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await server.close();
}
