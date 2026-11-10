import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";

test("dashboard selections survive closing the page, preference reloads and independent tray changes", async (t) => {
  const server = await createServer({
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  });
  await context.addInitScript(() => {
    if (location.protocol !== "http:") return;
    if (!localStorage.getItem("agent-usage.demo-preferences")) {
      localStorage.setItem(
        "agent-usage.demo-preferences",
        JSON.stringify({ onboarded: true, defaultRange: "month" }),
      );
    }
  });
  const base = server.resolvedUrls.local[0];
  const errors = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  let page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const value = async (name, expected) => {
    await page.getByRole("combobox", { name, exact: true }).waitFor();
    assert.equal(
      await page.getByRole("combobox", { name, exact: true }).inputValue(),
      expected,
    );
  };
  await page.goto(base);
  await page.getByRole("heading", { name: "Usage over time" }).waitFor();
  await value("Date range", "month");
  await page.getByRole("button", { name: "Tokens", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Chart aggregation" })
    .selectOption("week");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Project sort" })
    .selectOption("name");
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Model sort" })
    .selectOption("output");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Default date range" })
    .selectOption("7d");
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page.getByRole("textbox", { name: "Search settings" }).fill("source");
  await page.getByRole("link", { name: /^Sessions\b/ }).click();
  await page.getByRole("button", { name: "Choose columns" }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Models", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Group sessions" })
    .selectOption("week");
  await page
    .getByRole("button", { name: "Sort by session title ascending" })
    .click();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.locator("#session-filters select").selectOption("local");
  await page
    .getByRole("spinbutton", { name: "Minimum cost (usd)", exact: true })
    .fill("0.01");
  await page
    .getByRole("spinbutton", { name: "Maximum tokens", exact: true })
    .fill("10000");
  await page.getByLabel("Tag", { exact: true }).fill("review");
  await page
    .getByRole("button", { name: "Favorites only", exact: true })
    .click();
  await page
    .getByRole("button", { name: "All providers", exact: true })
    .click();
  await page
    .getByRole("menuitemcheckbox", { name: "Codex", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Date range", exact: true })
    .selectOption("custom");
  await page.getByLabel("Custom start date").fill("2026-10-01");
  await page.getByLabel("Custom end date").fill("2026-10-31");
  await page
    .getByRole("textbox", { name: "Search sessions" })
    .fill("just typed");
  await page.close();

  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(base);
  await page.getByRole("textbox", { name: "Search sessions" }).waitFor();
  assert.equal(new URL(page.url()).hash, "#/sessions");
  await value("Date range", "custom");
  assert.equal(
    await page.getByLabel("Custom start date").inputValue(),
    "2026-10-01",
  );
  assert.equal(
    await page.getByLabel("Custom end date").inputValue(),
    "2026-10-31",
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Search sessions" }).inputValue(),
    "just typed",
  );
  await page.getByRole("button", { name: "Codex", exact: true }).waitFor();
  await value("Group sessions", "week");
  assert.equal(
    await page
      .getByRole("button", { name: /^Filters/ })
      .getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Favorites only", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Minimum cost (usd)", exact: true })
      .inputValue(),
    "0.01",
  );
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Maximum tokens", exact: true })
      .inputValue(),
    "10000",
  );
  assert.equal(
    await page.getByLabel("Tag", { exact: true }).inputValue(),
    "review",
  );

  const tray = await context.newPage();
  await tray.goto(`${base}?window=tray`);
  await tray.getByRole("button", { name: "Claude Code", exact: true }).click();
  await tray.close();
  await page.reload();
  await page.getByRole("button", { name: "Codex", exact: true }).waitFor();
  const reopenedTray = await context.newPage();
  await reopenedTray.goto(`${base}?window=tray`);
  assert.equal(
    await reopenedTray
      .getByRole("button", { name: "Claude Code", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(new URL(reopenedTray.url()).hash, "");
  await reopenedTray.close();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Search settings" }).inputValue(),
    "source",
  );
  await page
    .getByRole("heading", { name: "Local sources", exact: true })
    .waitFor();
  await page.getByRole("textbox", { name: "Search settings" }).fill("");
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Default date range" })
    .selectOption("30d");
  await page.getByRole("link", { name: /^Sessions\b/ }).click();
  await value("Date range", "custom");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await value("Chart aggregation", "week");
  assert.match(
    await page
      .getByRole("button", { name: "Tokens", exact: true })
      .getAttribute("class"),
    /selected/,
  );
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await value("Project sort", "name");
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await value("Model sort", "output");
  await page.goto(`${base}#/sessions?session=explicit`);
  assert.equal(new URL(page.url()).hash, "#/sessions?session=explicit");
  assert.deepEqual(errors, []);
});
