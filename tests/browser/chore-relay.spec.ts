import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const views = [
  ["now", "On duty"],
  ["mine", "Your upcoming chores"],
  ["household", "Household schedule"],
  ["history", "Recent changes"],
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
    await expect(
      page.locator(`.primary-nav a[aria-current="page"]`),
    ).toHaveText(new RegExp(view, "i"));

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

test("view links navigate without replacing the document", async ({ page }) => {
  await page.goto("/?view=now");
  await page.evaluate(() => {
    (window as typeof window & { navigationMarker?: string }).navigationMarker =
      "preserved";
  });

  await page.getByRole("link", { name: "Mine" }).click();

  await expect(page).toHaveURL(/\?view=mine$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your upcoming chores" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { navigationMarker?: string })
          .navigationMarker,
    ),
  ).toBe("preserved");
});

test("view changes keep the header and content rails stationary", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const positions = () =>
    page.evaluate(() => ({
      header: document.querySelector(".header-row")?.getBoundingClientRect().x,
      main: document.querySelector(".main-content")?.getBoundingClientRect().x,
    }));
  const before = await positions();

  await page.getByRole("link", { name: "History" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent changes" }),
  ).toBeVisible();
  expect(await positions()).toEqual(before);

  await page.getByRole("link", { name: "Household" }).click();
  await expect(
    page.getByRole("heading", { name: "Household schedule" }),
  ).toBeVisible();
  expect(await positions()).toEqual(before);
});

test("signed-out landing is centered and omits application navigation", async ({
  page,
}) => {
  await page.goto("/?auth=unauthorized");
  await expect(
    page.getByRole("navigation", { name: "ChoRotate views" }),
  ).toHaveCount(0);
  await expect(page.getByText("This household is private")).toHaveCount(0);
  const button = page.getByRole("button", { name: "Sign in with Google" });
  await expect(button).toBeVisible();
  await expect(button.locator("svg.google-mark")).toBeVisible();
  await expect(button.locator(".google-mark path")).toHaveCount(4);
  const alignment = await page.locator(".sign-in-page").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      viewportX: window.innerWidth / 2,
      viewportY: window.innerHeight / 2,
    };
  });
  expect(Math.abs(alignment.centerX - alignment.viewportX)).toBeLessThan(2);
  expect(Math.abs(alignment.centerY - alignment.viewportY)).toBeLessThan(2);
});

test("authentication feedback animates without replacing button labels", async ({
  page,
}) => {
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    await requestGate;
    await route.fulfill({ status: 500, body: "{}" });
  });
  await page.goto("/?auth=unauthorized");
  const button = page.getByRole("button", { name: "Sign in with Google" });
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await button.click();
  await request;

  await expect(button).toHaveText("Sign in with Google");
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toHaveClass(/is-pending/);
  expect(
    await button.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("auth-submit-pending");

  releaseRequest();
  await expect(page.locator(".auth-status")).toContainText(
    "Sign in could not be started",
  );
});

test("sign out uses the Better Auth JSON request contract", async ({
  page,
}) => {
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    await requestGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/?view=now");

  const requestPromise = page.waitForRequest("**/api/auth/sign-out");
  await page.getByRole("button", { name: "Open profile menu" }).click();
  const button = page.getByRole("button", { name: "Sign out" });
  await button.click();
  const request = await requestPromise;

  expect(request.method()).toBe("POST");
  expect(request.headers()["content-type"]).toBe("application/json");
  expect(request.postDataJSON()).toEqual({});
  await expect(button).toHaveText("Sign out");
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toHaveClass(/is-pending/);
  releaseRequest();
});

test("profile control uses an available Google image and hides account actions", async ({
  page,
}) => {
  await page.route("https://lh3.googleusercontent.com/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto("/?view=now");

  const profile = page.getByRole("button", { name: "Open profile menu" });
  await expect(profile.locator("img")).toHaveAttribute(
    "src",
    "https://lh3.googleusercontent.com/a/profile-photo",
  );
  const shanePeople = page.locator(".person-member-d");
  expect(await shanePeople.count()).toBeGreaterThan(1);
  await expect(shanePeople.locator("img")).toHaveCount(
    await shanePeople.count(),
  );
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  const centering = await profile.evaluate((button) => {
    const control = button.getBoundingClientRect();
    const avatar = button.querySelector(".person")!.getBoundingClientRect();
    return Math.abs(
      control.left + control.width / 2 - (avatar.left + avatar.width / 2),
    );
  });
  expect(centering).toBeLessThan(1);
  await profile.click();
  const popover = page.locator(".profile-popover");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  const edges = await page.locator(".header-actions").evaluate((actions) => ({
    actions: actions.getBoundingClientRect().right,
    popover: actions.querySelector(".profile-popover")!.getBoundingClientRect()
      .right,
  }));
  expect(Math.abs(edges.actions - edges.popover)).toBeLessThan(1);
  await expect(popover).toBeVisible();
});

test("custom dropdown supports keyboard, mouse, tab, escape, and outside dismissal", async ({
  page,
}) => {
  await page.goto("/?view=household");
  await page.getByRole("button", { name: "Swap two turns" }).click();
  await expect(page.locator("select")).toHaveCount(0);
  const trigger = page.locator("#first-assignment-button");
  await expect(trigger).toHaveAccessibleName(
    "First turn: Choose an assignment",
  );

  await trigger.focus();
  await trigger.press("ArrowDown");
  const listbox = page.getByRole("listbox", {
    name: "First turn options",
  });
  await expect(listbox).toBeVisible();
  await expect(listbox).toBeFocused();
  await listbox.press("End");
  const activeId = await listbox.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  const keyboardSelection = (await page.locator(`#${activeId}`).textContent())!;
  await listbox.press("Enter");
  await expect(trigger).toHaveAccessibleName(
    `First turn: ${keyboardSelection}`,
  );

  await trigger.press("Enter");
  await expect(listbox).toBeVisible();
  await listbox.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.press("Space");
  await listbox.press("Tab");
  await expect(listbox).toBeHidden();

  await trigger.click();
  const mouseSelection = listbox.getByRole("option").nth(1);
  const mouseSelectionName = (await mouseSelection.textContent())!;
  await mouseSelection.click();
  await expect(trigger).toHaveAccessibleName(
    `First turn: ${mouseSelectionName}`,
  );
  await trigger.click();
  const selected = listbox.getByRole("option", { name: mouseSelectionName });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(selected).toHaveCSS("border-top-width", "0px");
  expect(
    await selected.evaluate((node) => getComputedStyle(node).boxShadow),
  ).toBe("none");
  await page.getByRole("heading", { name: "Swap two turns" }).click();
  await expect(listbox).toBeHidden();
});

test("Household owns swap and every rendered on-duty cell opens its assignment", async ({
  page,
}) => {
  await page.goto("/?view=now");
  await expect(
    page.getByRole("button", { name: "Swap two turns" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Reassign this turn/ }),
  ).toHaveCount(2);

  await page.getByRole("link", { name: "Household" }).click();
  await expect(
    page.getByRole("button", { name: "Swap two turns" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  const cell = page
    .getByRole("button", { name: /Reassign Trash, Fri, Sep 18/ })
    .first();
  await cell.click();
  await expect(
    page.getByRole("dialog", { name: "Reassign Trash" }),
  ).toContainText("Fri, Sep 18 – Thu, Sep 24");
  await page.getByRole("button", { name: "Close dialog" }).click();
});

test("two-step reassign submits exact one-time and optional balanced-swap payloads", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const open = page.getByRole("button", { name: /Reassign this turn/ }).first();
  await open.click();
  const dialog = page.locator(".change-dialog");
  await expect(dialog).not.toContainText("Who will take it?");
  await page.getByRole("radio", { name: /Member D/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("dialog", { name: "Review Trash change" }),
  ).toContainText("extra turn");
  await expect(
    page.getByRole("button", { name: /Balance with a future turn:/ }),
  ).toContainText("Keep as a one-time change");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".change-dialog")).toHaveAccessibleName(
    "Reassign Trash",
  );
  await expect(page.getByRole("radio", { name: /Member D/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();

  expect(await formPayload(page.locator(".change-dialog"))).toEqual({
    assignmentId: "2026-08-28-trash",
    expectedVersion: "1",
    intent: "reassign",
    recipientMemberId: "member-d",
    requestId: expect.stringMatching(/^request:/),
  });
  await page.getByRole("button", { name: "Confirm change" }).click();
  await expect(page.getByRole("status")).toContainText("handoff was saved");

  await open.click();
  await page.getByRole("radio", { name: /Member B/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  const balance = page.getByRole("button", {
    name: /Balance with a future turn:/,
  });
  await balance.click();
  const candidates = page.getByRole("listbox", {
    name: "Balance with a future turn options",
  });
  await expect(candidates.getByRole("option")).toHaveCount(3);
  await expect(candidates).not.toContainText("Aug 28");
  await candidates.getByRole("option", { name: /Trash — Fri, Sep 4/ }).click();
  expect(await formPayload(page.getByRole("dialog"))).toEqual({
    firstAssignmentId: "2026-08-28-trash",
    firstExpectedVersion: "1",
    intent: "swap",
    requestId: expect.stringMatching(/^request:/),
    secondAssignmentId: "2026-09-04-trash",
    secondExpectedVersion: "1",
  });
  await page.getByRole("button", { name: "Confirm change" }).click();
});

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
  await page.getByRole("radio", { name: /Member B/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review this change" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm change" }),
  ).toBeEnabled();
  const reviewDialog = page.getByRole("dialog", {
    name: "Review Trash change",
  });
  await expect(reviewDialog).toContainText("Current");
  await expect(reviewDialog).toContainText("Member A");
  await expect(reviewDialog).toContainText("New");
  await expect(reviewDialog).toContainText("Member B");
  await expect(reviewDialog).toContainText("Ownership range");

  const box = await reviewDialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

  await page.keyboard.press("Escape");
  await expect(reviewDialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("dialog closes only from its backdrop and protects pending changes", async ({
  page,
}) => {
  await page.goto("/?view=household&pending=1");
  const opener = page.getByRole("button", { name: "Swap two turns" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Swap two turns" });

  await dialog.locator("form").click({ position: { x: 8, y: 8 } });
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(Math.max(1, box!.x - 5), Math.max(1, box!.y - 5));
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  await chooseDropdown(page, "First turn", "2026-08-28-trash");
  await chooseDropdown(page, "Second turn", "2026-08-31-dishwasher");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  const pendingBox = await dialog.boundingBox();
  await page.mouse.click(
    Math.max(1, pendingBox!.x - 5),
    Math.max(1, pendingBox!.y - 5),
  );
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 4_000 });
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
  await expect(
    page
      .getByRole("button", {
        name: /Reassign Trash, Fri, Aug 28 – Thu, Sep 3/,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Reassign Dishwasher, Mon, Aug 31 – Sun, Sep 6/,
    }),
  ).toBeVisible();
  await expect(page.locator('time[datetime="2026-08-31"]')).toHaveAttribute(
    "aria-current",
    "date",
  );
  await expect(page.locator("main")).not.toContainText(/Turn 1|Dates by chore/);

  await page.goto("/?view=history");
  await expect(page.locator("main")).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(page.locator("main")).toContainText("Mon, Aug 31 – Sun, Sep 6");
});

test("mini calendars expose active ownership dates and the local today marker", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const calendar = page
    .getByRole("table", { name: "Trash current period" })
    .first();
  await expect(calendar).toBeVisible();
  await expect(calendar.locator('[data-in-range="true"]')).toHaveCount(7);
  await expect(calendar.locator('[data-date="2026-08-31"]')).toHaveAttribute(
    "data-today",
    "true",
  );

  await page.goto("/?view=mine");
  await expect(page.locator(".mini-calendar")).toHaveCount(2);
  await expect(
    page.locator('.mini-calendar [data-in-range="true"]'),
  ).toHaveCount(14);
});

test("household calendar moves between months without navigation", async ({
  page,
}) => {
  await page.goto("/?view=household");
  await expect(
    page.getByRole("heading", { name: "August 2026" }),
  ).toBeVisible();
  await expect(page.getByText("Assigned turns")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Reassign Trash.*Aug 14/ }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(
    page.getByRole("heading", { name: "September 2026" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/?view=household");

  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(
    page.getByRole("heading", { name: "August 2026" }),
  ).toBeVisible();
});

test("visible reminder states do not expose contact or provider data", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const main = page.locator("main");
  await expect(main).toContainText("Evening reminder accepted for sending");
  await expect(main).toContainText("Reminder delivery unconfirmed");
  await expect(main).toContainText("Reminder correction needed");
  await expect(main).not.toContainText("reminder planned");
  await expect(main).not.toContainText(/Textbelt|textId|quota|phone/i);
});

test("the household month calendar fits at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/?view=household");
  await expect(page.locator(".month-calendar")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "August 2026" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Previous month" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
  const fit = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(fit.documentWidth).toBeLessThanOrEqual(fit.viewportWidth);
  await expect(page.locator("select")).toHaveCount(0);
});

test("history hides internal IDs and fits at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/?view=history");

  await expect(page.locator("main")).not.toContainText(
    "123e4567-e89b-12d3-a456-426614174000",
  );
  const fit = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    shellWidth: document.querySelector(".app-shell")?.scrollWidth,
  }));
  expect(fit.documentWidth).toBeLessThanOrEqual(fit.viewportWidth);
  expect(fit.shellWidth).toBeLessThanOrEqual(fit.viewportWidth);
});

test("atomic swap dialog reviews both legs and keeps its action fitted", async ({
  page,
}) => {
  await page.goto("/?view=household");
  await page.getByRole("button", { name: "Swap two turns" }).click();
  const dialog = page.getByRole("dialog", { name: "Swap two turns" });
  await expect(dialog).toBeVisible();
  await chooseDropdown(page, "First turn", "2026-08-28-trash");
  await chooseDropdown(page, "Second turn", "2026-08-31-dishwasher");
  await expect(page.getByRole("button", { name: /First turn:/ })).toContainText(
    "Trash — Fri, Aug 28 – Thu, Sep 3 — Member A",
  );
  await expect(
    page.getByRole("button", { name: /Second turn:/ }),
  ).toContainText("Dishwasher — Mon, Aug 31 – Sun, Sep 6 — Member C");
  await expect(
    page.getByRole("heading", { name: "Review both swap legs" }),
  ).toBeVisible();
  await expect(page.getByText("Leg 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Leg 2", { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(/Outgoing|Incoming/);
  await expect(dialog).toContainText("Current");
  await expect(dialog).toContainText("After swap");
  await expect(dialog).not.toContainText("Both assignments update together");
  await expect(dialog).not.toContainText("confirm as one operation");
  await expect(dialog).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(dialog).toContainText("Mon, Aug 31 – Sun, Sep 6");
  expect(await formPayload(dialog)).toEqual({
    firstAssignmentId: "2026-08-28-trash",
    firstExpectedVersion: "1",
    intent: "swap",
    requestId: expect.stringMatching(/^request:/),
    secondAssignmentId: "2026-08-31-dishwasher",
    secondExpectedVersion: "1",
  });
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeEnabled();
  const fit = await confirm.evaluate((button) => ({
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth,
  }));
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
  const position = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      y: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
    };
  });
  expect(position.x).toBeLessThan(2);
  expect(position.y).toBeLessThan(2);
});

test("stale recovery names refreshed ownership values and requires intentional retry", async ({
  page,
}) => {
  await page.goto("/?view=now");
  await page
    .getByRole("button", { name: /Reassign this turn/ })
    .first()
    .click();
  const dialog = page.locator(".change-dialog");
  await page.getByRole("radio", { name: /Member B/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm change" }).click();

  const issue = dialog.getByRole("alert");
  await expect(issue).toBeFocused();
  await expect(issue).toContainText("Trash");
  await expect(issue).toContainText("Fri, Aug 28 – Thu, Sep 3");
  await expect(issue).toContainText("Current owner: Member C");
  await expect(
    page.getByRole("button", { name: "Confirm change" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Review current values" }).click();
  const reviewed = page.getByRole("button", {
    name: "Current values reviewed",
  });
  await expect(reviewed).toBeFocused();
  await expect(reviewed).toHaveAttribute("aria-disabled", "true");
  await expect(dialog).toContainText("Current");
  await expect(dialog).toContainText("Member C");
  await expect(dialog).toContainText("New");
  await expect(dialog).toContainText("Member B");
  await expect(
    page.getByRole("button", { name: "Confirm change" }),
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
    const dialog = page.locator(".change-dialog");
    await expect(dialog).toHaveAccessibleName(`Reassign ${ended.chore}`);
    await page.getByRole("radio", { name: /Member A/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Confirm change" }).click();

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

  await page.getByRole("link", { name: "Household" }).click();
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
  const target = colorScheme === "dark" ? "light" : "dark";
  const control = page.getByRole("button", {
    name: `Switch to ${target} mode`,
  });
  await control.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", target);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    target === "dark" ? "#1d201c" : "#fffefa",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", target);
});

test("light mode uses the flat neutral canvas", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?view=now");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".app-shell")).toHaveCSS(
    "background-color",
    "rgb(243, 241, 235)",
  );
  expect(
    await page
      .locator(".app-shell")
      .evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toBe("none");
});

test("landing and header use the same brand-mark geometry", async ({
  page,
}) => {
  await page.goto("/?view=now");
  const headerMark = await markGeometry(page);
  await page.goto("/?auth=unauthorized");
  expect(await markGeometry(page)).toEqual(headerMark);
});

async function chooseDropdown(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
}

function formPayload(container: Locator) {
  return container
    .locator("form")
    .evaluate((form) =>
      Object.fromEntries(
        [...new FormData(form as HTMLFormElement).entries()].map(
          ([key, value]) => [key, String(value)],
        ),
      ),
    );
}

async function markGeometry(page: Page) {
  return page
    .locator(".brand-mark")
    .first()
    .evaluate((mark) => {
      const style = getComputedStyle(mark);
      const box = mark.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        radius: style.borderRadius,
      };
    });
}
