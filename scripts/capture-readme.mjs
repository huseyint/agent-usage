import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

// Run against `pnpm dev`. All fixture overrides stay in this browser context.
const base = process.env.APP_URL || "http://127.0.0.1:1420";
const out = fileURLToPath(new URL("../docs/images/", import.meta.url));
const raw = fileURLToPath(
  new URL("../.cache/readme-captures/", import.meta.url),
);
await mkdir(out, { recursive: true });
await mkdir(raw, { recursive: true });

const iconShapes = [
  ["#5b5bd6", '<path d="M8 10h16v5H8zm0 7h7v5H8zm9 0h7v5h-7z"/>'],
  [
    "#d45b8d",
    '<circle cx="12" cy="12" r="5"/><circle cx="21" cy="12" r="4"/><path d="M7 19h10v7H7zm12-1 7 7h-7z"/>',
  ],
  [
    "#1b977d",
    '<path d="m12 9-6 7 6 7 2-2-4-5 4-5zm8 0-2 2 4 5-4 5 2 2 6-7z"/>',
  ],
  [
    "#cb8230",
    '<circle cx="16" cy="16" r="9" fill="none" stroke="white" stroke-width="2"/><path d="M7 15h18v2H7zM15 7h2v18h-2z"/>',
  ],
  ["#397dd0", '<path d="m16 5 3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>'],
  ["#788553", '<path d="M8 7h11l5 5v13H8zm3 8v2h10v-2zm0 5v2h7v-2z"/>'],
];
const projectNames = [
  "workbench",
  "design-system",
  "api-service",
  "personal-site",
  "agent-tools",
  "docs",
];
const icons = Object.fromEntries(
  projectNames.map((name, i) => {
    const [color, shape] = iconShapes[i];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><g fill="white">${shape}</g></svg>`;
    return [
      name,
      {
        kind: "image",
        source: "Project icon",
        src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      },
    ];
  }),
);

function replace(source, from, to) {
  assert.ok(
    source.includes(from),
    `Capture fixture no longer matches: ${from}`,
  );
  return source.replace(from, to);
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const screens = {};
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 820 },
      deviceScaleFactor: 2,
      timezoneId: "America/Chicago",
      colorScheme: theme,
    });
    await context.addInitScript(
      ({ theme }) => {
        localStorage.setItem(
          "agent-usage.ui-preferences",
          JSON.stringify({
            state: { theme, sidebarVisible: true, sidebarWidth: 300 },
            version: 1,
          }),
        );
        localStorage.setItem(
          "agent-usage.demo-preferences",
          JSON.stringify({
            theme,
            timezone: "America/Chicago",
            onboarded: true,
            claudeMonthlyAllowanceUsd: 25,
            codexMonthlyAllowanceUsd: 12,
          }),
        );
      },
      { theme },
    );
    await context.route("**/src/lib/demo.ts*", async (route) => {
      const response = await route.fetch();
      let source = (await response.text()).split("//# sourceMappingURL=")[0];
      source = replace(
        source,
        "const count = weekend ?",
        "const count = day === 0 ? 6 : weekend ?",
      );
      source = replace(
        source,
        'const provider = seed % 3 ? "claude" : "codex";',
        'const provider = (day === 0 && i === 5) || seed % 3 === 0 ? "codex" : "claude";',
      );
      source = replace(
        source,
        "at.setHours(8 + i * 2, seed % 60);",
        "at.setHours(8 + i * 2, seed % 60); if (day === 0) at.setHours(9 + Math.floor(i * 1.5), i === 5 ? 41 : 12 + i * 5);",
      );
      source = replace(
        source,
        "allSessions.slice(-2)",
        "allSessions.slice(-1)",
      );
      source = source.replaceAll("/synthetic/", "/Users/alex/Projects/");
      await route.fulfill({ response, body: source });
    });
    await context.route("**/src/lib/usage-api.ts*", async (route) => {
      const response = await route.fetch();
      const source = (await response.text()).split("//# sourceMappingURL=")[0];
      await route.fulfill({
        response,
        body: `${source}\nusageApi.projectIcons = async paths => {
        const icons = ${JSON.stringify(icons)};
        return Object.fromEntries(paths.map(path => [path, icons[path.split('/').at(-1)]]));
      };`,
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-06T16:42:00-06:00"));
    await page.goto(`${base}/#/sessions`);
    await page.locator(".session-name").first().waitFor();
    await page.getByText("Working", { exact: true }).waitFor();
    const captureStyle = `.demo-label, .tray-preview-label { display: none !important; }
      *, *::before, *::after { animation: none !important; caret-color: transparent !important; }`;
    await page.addStyleTag({ content: captureStyle });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".source-allowance")].every(
        (el) => el.value > 0,
      ),
    );
    assert.equal(await page.locator(".source-allowance").count(), 2);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".project-avatar img")].every(
        (el) => el.complete && el.naturalWidth > 0,
      ),
    );
    await page.mouse.move(1390, 810);
    const sessionFile = path.join(raw, `sessions-${theme}.png`);
    await page.screenshot({ path: sessionFile, animations: "disabled" });
    screens[theme] =
      `data:image/png;base64,${(await readFile(sessionFile)).toString("base64")}`;
    console.log(`Captured sessions (${theme})`);

    if (theme === "light") {
      await page.setViewportSize({ width: 1400, height: 1450 });
      await page.getByRole("link", { name: "Overview", exact: true }).click();
      await page.locator(".project-rank").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page
        .locator(".page-scroll")
        .evaluate((element) => element.scrollHeight - element.clientHeight);
      const overviewHeight = 1450 + overflow;
      await page.setViewportSize({ width: 1400, height: overviewHeight });
      await page.screenshot({
        path: path.join(raw, "overview.png"),
        animations: "disabled",
      });
      const overview = `data:image/png;base64,${(await readFile(path.join(raw, "overview.png"))).toString("base64")}`;
      await frame({
        image: overview,
        width: 1400,
        height: overviewHeight,
        file: "overview.png",
      });
      await page.setViewportSize({ width: 500, height: 900 });
      await page.goto(`${base}/?window=tray`);
      await page.getByText("Working", { exact: true }).waitFor();
      await page.addStyleTag({
        content: `${captureStyle}
        .tray-browser-preview { height: 690px; margin: 0; box-shadow: none; }`,
      });
      await page.locator(".tray-popover").screenshot({
        path: path.join(raw, "menubar.png"),
        animations: "disabled",
      });
      const tray = `data:image/png;base64,${(await readFile(path.join(raw, "menubar.png"))).toString("base64")}`;
      await frame({
        image: tray,
        width: 420,
        height: 690,
        file: "menubar.png",
        // Markdown viewers may fill the content width regardless of PNG size.
        // Keep the popover compact within that width without an HTML image tag.
        canvasWidth: 1120,
        padding: 32,
      });
      console.log("Captured overview and menu bar (light)");
    }
    await context.close();
  }
  await frame({
    image: screens.light,
    dark: screens.dark,
    width: 1400,
    height: 820,
    file: "sessions.png",
  });
  assert.deepEqual(errors, [], "Browser runtime errors");
} finally {
  await browser.close();
}

async function frame({
  image,
  dark,
  width,
  height,
  file,
  padding = 48,
  canvasWidth = width + padding * 2,
}) {
  const canvasHeight = height + padding * 2;
  const windowLeft = (canvasWidth - width) / 2;
  const splitTop = width * 0.67;
  const splitBottom = width * 0.43;
  const slope = (splitBottom - splitTop) / height;
  // Extend the app's split through the padding in canvas coordinates.
  const backgroundTop = windowLeft + splitTop - slope * padding;
  const backgroundBottom = windowLeft + splitBottom + slope * padding;
  const page = await browser.newPage({
    viewport: { width: canvasWidth, height: canvasHeight },
    deviceScaleFactor: 2,
  });
  await page.setContent(`<!doctype html><style>
    * { box-sizing: border-box; } body { margin: 0; background: #e9edf2; }
    .back { position: absolute; inset: 0; background: linear-gradient(135deg,#edeef7,#e3eaf0); }
    .night { position: absolute; inset: 0; background: linear-gradient(135deg,#292b39,#171a24); clip-path: polygon(${backgroundTop}px 0,100% 0,100% 100%,${backgroundBottom}px 100%); }
    .window { position: absolute; left: ${windowLeft}px; top: ${padding}px; width: ${width}px; height: ${height}px; border-radius: 12px; overflow: hidden; box-shadow: 0 18px 45px #15233b28,0 0 0 1px #24365020; }
    img { position: absolute; inset: 0; width: 100%; height: 100%; }
    .dark { clip-path: polygon(${splitTop}px 0,100% 0,100% 100%,${splitBottom}px 100%); }
    </style><div class="back"></div>${dark ? '<div class="night"></div>' : ""}
    <div class="window"><img src="${image}">${dark ? `<img class="dark" src="${dark}">` : ""}</div>`);
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => img.decode())),
  );
  await page.screenshot({ path: path.join(out, file) });
  await page.close();
}
