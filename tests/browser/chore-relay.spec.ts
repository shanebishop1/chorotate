import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const views = [
  ["now", "The handoff starts here"],
  ["mine", "Shane’s turns"],
  ["household", "The whole household, in motion"],
  ["history", "Every handoff, kept together"],
] as const;

for (const [view, heading] of views) {
  test(`${view} is semantic, accessible, and free of page overflow`, async ({
    page,
  }) => {
    await page.goto(`/?view=${view}`);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "ChoRotate views" }),
    ).toBeVisible();
    await expect(page.locator(`a[aria-current="page"]`)).toHaveText(
      new RegExp(view, "i"),
    );

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("dialog fits, exposes review semantics, and restores keyboard focus", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const opener = page
    .getByRole("button", { name: /Reassign this turn/ })
    .first();
  await opener.focus();
  await opener.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Reassign Trash" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.getByRole("radio", { name: /Joe/ }).check();
  await expect(
    page.getByRole("heading", { name: "Review this handoff" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm handoff" }),
  ).toBeEnabled();
  await expect(dialog).toContainText("Outgoing person");
  await expect(dialog).toContainText("Jack");
  await expect(dialog).toContainText("Incoming person");
  await expect(dialog).toContainText("Joe");
  await expect(dialog).toContainText("Ownership range");

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("current and next handoffs name each chore-specific period at point of use", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const trash = page.getByRole("article").filter({ hasText: "Trash" });
  await expect(trash).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(trash).toContainText("Fri, Sep 4 – Thu, Sep 10");
  const dishwasher = page
    .getByRole("article")
    .filter({ hasText: "Dishwasher" });
  await expect(dishwasher).toContainText("Mon, Aug 31 – Sun, Sep 6");
  await expect(dishwasher).toContainText("Mon, Sep 7 – Sun, Sep 13");
  await expect(page.locator("main")).not.toContainText(
    /this week|next week|household week/i,
  );
});

test("assignment, household, and history states keep chore periods attached", async ({
  page,
}) => {
  await page.goto("/?view=mine");
  await expect(page.locator("main")).toContainText("Mon, Sep 7 – Sun, Sep 13");
  await expect(page.locator("main")).toContainText("Fri, Sep 18 – Thu, Sep 24");

  await page.goto("/?view=household");
  await expect(page.locator("main")).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(page.locator("main")).toContainText("Mon, Aug 31 – Sun, Sep 6");
  await expect(
    page.locator('th[scope="col"]', { hasText: "Period" }),
  ).toBeAttached();
  await expect(page.locator("main")).not.toContainText(/Turn 1|Dates by chore/);

  const periodStarts = await page
    .locator("[data-period-start]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-period-start")),
    );
  const firstSequence = [...new Set(periodStarts)];
  expect(firstSequence.slice(0, 4)).toEqual([
    "2026-08-28",
    "2026-08-31",
    "2026-09-04",
    "2026-09-07",
  ]);

  await page.goto("/?view=history");
  await expect(page.locator("main")).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(page.locator("main")).toContainText("Mon, Aug 31 – Sun, Sep 6");
});

test("safe reminder states are useful without exposing contact or provider data", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const main = page.locator("main");
  await expect(main).toContainText("Evening reminder accepted for sending");
  await expect(main).toContainText("Reminder delivery unconfirmed");
  await expect(main).toContainText("Reminder correction needed");
  await expect(main).toContainText("Reminder contact missing");
  await expect(main).toContainText("Reminders suppressed");
  await expect(main).not.toContainText(/Textbelt|textId|quota|phone/i);
});

test("the chronological household schedule reflows at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/?view=household");
  await expect(page.locator(".schedule-list")).toBeVisible();
  await expect(page.locator(".schedule-table-wrap")).toBeHidden();
  await expect(page.locator("main")).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(page.locator("main")).toContainText("Mon, Aug 31 – Sun, Sep 6");
  const fit = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(fit.documentWidth).toBeLessThanOrEqual(fit.viewportWidth);
  for (const select of await page.getByRole("combobox").all()) {
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("atomic swap dialog reviews both legs and keeps its action fitted", async ({
  page,
}) => {
  await page.goto("/?view=now");
  await page.getByRole("button", { name: "Swap two turns" }).click();
  const dialog = page.getByRole("dialog", { name: "Swap two turns" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("First turn").selectOption("2026-08-28-trash");
  await page.getByLabel("Second turn").selectOption("2026-08-31-dishwasher");
  await expect(
    page.getByLabel("First turn").locator("option:checked"),
  ).toHaveText("Trash — Fri, Aug 28 – Thu, Sep 3 — outgoing Jack");
  await expect(
    page.getByLabel("Second turn").locator("option:checked"),
  ).toHaveText("Dishwasher — Mon, Aug 31 – Sun, Sep 6 — outgoing Dylan");
  await expect(
    page.getByRole("heading", { name: "Review both swap legs" }),
  ).toBeVisible();
  await expect(page.getByText("Leg 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Leg 2", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(dialog).toContainText("Mon, Aug 31 – Sun, Sep 6");
  const confirm = page.getByRole("button", { name: "Confirm atomic swap" });
  await expect(confirm).toBeEnabled();
  const fit = await confirm.evaluate((button) => ({
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth,
  }));
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
});

test("stale recovery names refreshed ownership values and requires intentional retry", async ({
  page,
}) => {
  await page.goto("/?view=now");
  await page
    .getByRole("button", { name: /Reassign this turn/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Reassign Trash" });
  await page.getByRole("radio", { name: /Joe/ }).check();
  await page.getByRole("button", { name: "Confirm handoff" }).click();

  const issue = dialog.getByRole("alert");
  await expect(issue).toBeFocused();
  await expect(issue).toContainText("Trash");
  await expect(issue).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(issue).toContainText("Current owner: Dylan");
  await expect(
    page.getByRole("button", { name: "Confirm handoff" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Review current values" }).click();
  const reviewed = page.getByRole("button", {
    name: "Current values reviewed",
  });
  await expect(reviewed).toBeFocused();
  await expect(reviewed).toHaveAttribute("aria-disabled", "true");
  await expect(dialog).toContainText("Outgoing person");
  await expect(dialog).toContainText("Dylan");
  await expect(dialog).toContainText("Incoming person");
  await expect(dialog).toContainText("Joe");
  await expect(
    page.getByRole("button", { name: "Confirm handoff" }),
  ).toBeEnabled();
});

for (const ended of [
  {
    id: "2026-08-21-trash",
    chore: "Trash",
    range: "Fri, Aug 21 – Thu, Aug 27",
  },
  {
    id: "2026-08-24-dishwasher",
    chore: "Dishwasher",
    range: "Mon, Aug 24 – Sun, Aug 30",
  },
] as const) {
  test(`ended ${ended.chore} ownership period is denied with an actionable range`, async ({
    page,
  }) => {
    await page.goto(`/?view=now&ended=${ended.chore.toLowerCase()}`);
    const choreCard = page
      .getByRole("article")
      .filter({ hasText: ended.chore });
    await choreCard.getByRole("button", { name: "Reassign this turn" }).click();
    const dialog = page.getByRole("dialog", {
      name: `Reassign ${ended.chore}`,
    });
    await page.getByRole("radio", { name: /Jack/ }).check();
    await page.getByRole("button", { name: "Confirm handoff" }).click();

    const issue = dialog.getByRole("alert");
    await expect(issue).toContainText("ownership period has ended");
    await expect(issue).toContainText(ended.chore);
    await expect(issue).toContainText(ended.range);
    await expect(issue).toContainText("Choose current or future assignments");
  });
}

test("skip navigation, visible focus, fitted controls, and reduced motion work", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=now");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveCSS("outline-style", "solid");
  await skip.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const fitted = page.getByRole("button", { name: "Swap two turns" });
  const fit = await fitted.evaluate((button) => ({
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth,
    height: button.getBoundingClientRect().height,
  }));
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
  expect(fit.height).toBeGreaterThanOrEqual(44);

  const animationSeconds = await page.locator(".app-shell").evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "toast";
    document.body.appendChild(probe);
    const duration = Number.parseFloat(
      getComputedStyle(probe).animationDuration,
    );
    probe.remove();
    return duration;
  });
  expect(animationSeconds).toBeLessThanOrEqual(0.000_01);
});

test("theme control switches the rendered shell independently of system mode", async ({
  page,
  colorScheme,
}) => {
  await page.goto("/?view=household");
  const shell = page.locator(".app-shell");
  await page.getByRole("button", { name: "Toggle color mode" }).click();
  await expect(shell).toHaveAttribute(
    "data-theme",
    colorScheme === "dark" ? "light" : "dark",
  );
});
