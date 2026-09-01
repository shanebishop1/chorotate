import { describe, expect, it, vi } from "vitest";

import { createCloudflareRuntimeContext } from "../../runtime/context";
import { validTestEnvironment } from "../../runtime/test-fixtures";
import { createScheduledReminderDispatcher } from "./scheduled";

describe("scheduled reminders", () => {
  it("does not plan, construct transport, or dispatch while SMS is disabled", async () => {
    const plan = vi.fn();
    const createTransport = vi.fn();
    const createDispatcher = vi.fn();
    const scheduled = createScheduledReminderDispatcher({
      plan,
      createTransport,
      createDispatcher,
    });
    const runtime = createCloudflareRuntimeContext(
      {
        ...validTestEnvironment(),
        REMINDER_SMS_ENABLED: "false",
      } as Parameters<typeof createCloudflareRuntimeContext>[0],
      {} as ExecutionContext,
    );

    await scheduled({ scheduledTime: 123 } as ScheduledController, runtime);

    expect(plan).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(createDispatcher).not.toHaveBeenCalled();
  });

  it("wires fixed public Textbelt transport without secret or email config", async () => {
    const planningTime = new Date("2026-03-08T09:00:00.000Z");
    const claimTime = new Date("2026-03-08T09:01:00.000Z");
    const plan = vi.fn(async () => ({ assignmentsConsidered: 0 }));
    const createTransport = vi.fn(() => ({ send: vi.fn() }));
    const dispatch = vi.fn(async () => ({
      claimed: 0,
      accepted: 0,
      failed: 0,
      deliveryUnknown: 0,
      ownershipLost: 0,
    }));
    const scheduled = createScheduledReminderDispatcher({
      now: vi
        .fn<() => Date>()
        .mockReturnValueOnce(planningTime)
        .mockReturnValueOnce(claimTime),
      randomId: () => "random",
      plan,
      createTransport,
      createDispatcher: vi.fn(() => ({ dispatch })),
    });
    const runtime = createCloudflareRuntimeContext(
      validTestEnvironment(),
      {} as ExecutionContext,
    );

    await scheduled({ scheduledTime: 123 } as ScheduledController, runtime);

    expect(createTransport).toHaveBeenCalledWith({
      timeoutMilliseconds: 10_000,
    });
    expect(dispatch).toHaveBeenCalledWith({
      now: claimTime,
      leaseOwner: "cron:123:random",
      batchSize: 25,
      leaseMilliseconds: 300_000,
      providerTimeoutMilliseconds: 10_000,
    });
  });
});
