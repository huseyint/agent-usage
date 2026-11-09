import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

// Run against `pnpm dev`. Fixtures affect this browser context only.
const base = process.env.APP_URL || "http://127.0.0.1:1420";
const out = fileURLToPath(
  new URL("../docs/screenshots/allowance/", import.meta.url),
);
await mkdir(out, { recursive: true });
const states = [
  {
    id: "below",
    label: "Below pace",
    detail: "30% used · 50% of month",
    spend: 30,
    pace: "below-pace",
  },
  {
    id: "on",
    label: "On pace",
    detail: "50% used · 50% of month",
    spend: 50,
    pace: "on-pace",
  },
  {
    id: "above",
    label: "Above pace",
    detail: "75% used · 50% of month",
    spend: 75,
    pace: "above-pace",
  },
  {
    id: "zero",
    label: "No usage yet",
    detail: "0% used · 50% of month",
    spend: 0,
    pace: "below-pace",
  },
  {
    id: "reached",
    label: "Allowance reached",
    detail: "100% used · 50% of month",
    spend: 100,
    pace: "exhausted",
  },
  {
    id: "exceeded",
    label: "Over allowance",
    detail: "125% used · 50% of month",
    spend: 125,
    pace: "exhausted",
  },
  {
    id: "incomplete",
    label: "Incomplete pricing",
    detail: "Known spend only · neutral fill",
    spend: 30,
    pace: "unknown",
  },
  {
    id: "cached",
    label: "Cached snapshot",
    detail: "Last known spend · notice on hover",
    spend: 75,
    pace: "above-pace",
  },
  {
    id: "unset",
    label: "No allowance configured",
    detail: "Bar and tick stay hidden",
    spend: 0,
  },
  {
    id: "loading",
    label: "Loading",
    detail: "Empty track · no pace claim",
    spend: 0,
    pace: "unknown",
  },
  {
    id: "error",
    label: "Spend unavailable",
    detail: "Empty track · details on hover",
    spend: 0,
    pace: "unknown",
  },
  {
    id: "no-snapshot",
    label: "Before first refresh",
    detail: "Empty track · refresh hint on hover",
    spend: 0,
    pace: "unknown",
  },
];
const edges = [
  {
    id: "month-start",
    label: "Start of month",
    detail: "Nov 1 · tick at 3.3%",
    date: "2026-11-01",
    spend: 0,
    pace: "below-pace",
  },
  {
    id: "month-end",
    label: "End of month",
    detail: "Nov 30 · tick at 100%",
    date: "2026-11-30",
    spend: 75,
    pace: "below-pace",
  },
  {
    id: "single-provider",
    label: "One allowance configured",
    detail: "Each provider is independent",
    spend: 30,
    pace: "below-pace",
  },
];
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const theme of ["light", "dark"]) {
    const captures = [];
    for (const state of [...states, ...edges]) {
      const context = await browser.newContext({
        viewport: { width: 1100, height: 760 },
        deviceScaleFactor: 2,
        timezoneId: "America/Chicago",
        colorScheme: theme,
      });
      await context.addInitScript(
        ({ theme, state }) => {
          window.allowanceFixture = state;
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
              claudeMonthlyAllowanceUsd: state.id === "unset" ? null : 100,
              codexMonthlyAllowanceUsd: ["unset", "single-provider"].includes(
                state.id,
              )
                ? null
                : 100,
            }),
          );
        },
        { theme, state },
      );
      await context.route("**/src/lib/usage-api.ts*", async (route) => {
        const response = await route.fetch();
        const source = (await response.text()).split(
          "//# sourceMappingURL=",
        )[0];
        await route.fulfill({
          response,
          body: `${source}
          const fixture = window.allowanceFixture;
          const originalBootstrap = usageApi.bootstrap;
          usageApi.bootstrap = async () => ({
            ...await originalBootstrap(), hasSnapshot: fixture.id !== "no-snapshot",
          });
          const originalView = usageApi.view;
          usageApi.view = async query => {
            if (query.limit !== 1) return originalView(query);
            if (fixture.id === "loading") return new Promise(() => {});
            if (fixture.id === "error") throw new Error("Fixture: monthly spend unavailable");
            const data = await originalView(query);
            return { ...data, stale: fixture.id === "cached", daily: ["claude", "codex"].map(provider => ({
              date: query.until, provider, costMicros: fixture.spend * 1e6,
              missingPricing: fixture.id === "incomplete",
            })) };
          };
        `,
        });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(
        new Date(`${state.date || "2026-11-15"}T12:00:00-06:00`),
      );
      await page.goto(`${base}/#/sessions`);
      const row = page.locator(".source-nav-item").first();
      await row.waitFor();
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        theme,
      );
      await page.evaluate(() => document.fonts.ready);
      if (state.id === "unset") {
        assert.equal(await page.locator(".source-allowance").count(), 0);
      } else {
        await page.waitForFunction(
          ({ pace, unavailable, spend }) => {
            const track = document.querySelector(".source-allowance-track");
            return (
              track?.dataset.pace === pace &&
              track.hasAttribute("data-unavailable") === unavailable &&
              track.querySelector("progress").value === Math.min(spend, 100)
            );
          },
          {
            pace: state.pace,
            unavailable: ["loading", "error", "no-snapshot"].includes(state.id),
            spend: state.spend,
          },
        );
        const markerCount = await row
          .locator(".source-allowance-marker")
          .count();
        assert.equal(
          markerCount,
          ["loading", "error", "no-snapshot"].includes(state.id) ? 0 : 1,
        );
        if (state.id === "single-provider")
          assert.equal(await page.locator(".source-allowance").count(), 1);
      }
      await page.mouse.move(1090, 10);
      const file = path.join(out, `${state.id}-${theme}.png`);
      await page
        .locator(".source-nav")
        .screenshot({ path: file, animations: "disabled" });
      captures.push({
        ...state,
        image: `data:image/png;base64,${(await readFile(file)).toString("base64")}`,
      });
      await row.locator("a").focus();
      const tooltip = row.getByRole("tooltip");
      await tooltip.waitFor();
      if (state.id === "error")
        await tooltip
          .getByText("Monthly spend unavailable", { exact: true })
          .waitFor();
      if (state.id === "cached")
        await tooltip
          .getByText("Cached snapshot. Refresh to update.", { exact: true })
          .waitFor();
      if (state.id === "incomplete")
        await tooltip.getByText("Pace unavailable", { exact: true }).waitFor();
      if (state.id === "above") {
        await tooltip.getByText("Above pace", { exact: true }).waitFor();
        const bounds = await tooltip.boundingBox();
        await page.screenshot({
          path: path.join(out, `hover-${theme}.png`),
          clip: {
            x: 0,
            y: Math.floor(bounds.y) - 16,
            width: Math.ceil(bounds.x + bounds.width) + 20,
            height: Math.ceil(bounds.height) + 80,
          },
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        assert.equal(await row.getByRole("tooltip").count(), 0);
        await page.mouse.move(1090, 10);
        await page.locator("a.usage-nav-link").first().focus();
        await page.screenshot({
          path: path.join(out, `app-${theme}.png`),
          animations: "disabled",
        });
      }
      await page.keyboard.press("Escape");
      assert.equal(await row.getByRole("tooltip").count(), 0);
      await context.close();
    }
    const gallery = await browser.newPage({
      viewport: { width: 860, height: 1164 },
      deviceScaleFactor: 2,
    });
    const dark = theme === "dark";
    await gallery.setContent(`<!doctype html><style>
      * { box-sizing: border-box; } body { margin: 0; padding: 36px; font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${dark ? "#19191c" : "#fff"}; color: ${dark ? "#ededf0" : "#15181c"}; }
      h1 { font-size: 24px; letter-spacing: -.6px; margin: 0 0 10px; font-weight: 600; }
      p { margin: 0 0 26px; color: ${dark ? "#b5b5bd" : "#4b535d"}; line-height: 1.5; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      article { border: 1px solid ${dark ? "#2d2d32" : "#dee1e6"}; border-radius: 10px; overflow: hidden; }
      header { padding: 14px 14px 12px; } strong { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; }
      small { color: ${dark ? "#8f8f99" : "#646c76"}; font-size: 11px; }
      .sample { background: ${dark ? "#252525" : "#ebebeb"}; padding: 10px 28px 14px; }
      img { width: 191px; height: 103px; object-fit: contain; display: block; max-width: 100%; }
      footer { margin-top: 20px; color: ${dark ? "#8f8f99" : "#646c76"}; font-size: 11px; }
    </style><h1>Monthly allowance · ${theme}</h1>
    <p>The tick marks today. The fill shows allowance used.<br>November 15 · halfway through the month, unless noted.</p>
    <div class="grid">${captures.map((c) => `<article><header><strong>${c.label}</strong><small>${c.detail}</small></header><div class="sample"><img src="${c.image}"></div></article>`).join("")}</div>
    <footer>Actual app screenshots · labels are outside the product UI · on pace includes ±2 percentage points</footer>`);
    await gallery.evaluate(() =>
      Promise.all([...document.images].map((image) => image.decode())),
    );
    await gallery.screenshot({
      path: path.join(out, `all-states-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await gallery.close();
    console.log(`Captured all allowance states (${theme})`);
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
} finally {
  await browser.close();
}
