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

  it("wires the private Textbelt key into the transport", async () => {
    const firstClaimTime = new Date("2026-03-08T09:00:00.000Z");
    const planningTime = new Date("2026-03-08T09:01:00.000Z");
    const secondClaimTime = new Date("2026-03-08T09:02:00.000Z");
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
        .mockReturnValueOnce(firstClaimTime)
        .mockReturnValueOnce(planningTime)
        .mockReturnValueOnce(secondClaimTime),
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
      apiKey: "test-only-textbelt-api-key",
      timeoutMilliseconds: 10_000,
    });
    expect(dispatch.mock.calls).toEqual([
      [
        {
          now: firstClaimTime,
          leaseOwner: "cron:123:queued:random",
          batchSize: 25,
          leaseMilliseconds: 300_000,
          providerTimeoutMilliseconds: 10_000,
        },
      ],
      [
        {
          now: secondClaimTime,
          leaseOwner: "cron:123:planned:random",
          batchSize: 25,
          leaseMilliseconds: 300_000,
          providerTimeoutMilliseconds: 10_000,
        },
      ],
    ]);
  });

  it("dispatches durable due work before a planning failure", async () => {
    const failure = new Error("planning exceeded its runtime budget");
    const plan = vi.fn(async () => {
      throw failure;
    });
    const dispatch = vi.fn(async () => ({
      claimed: 1,
      accepted: 1,
      failed: 0,
      deliveryUnknown: 0,
      ownershipLost: 0,
    }));
    const scheduled = createScheduledReminderDispatcher({
      now: () => new Date("2026-03-08T09:00:00.000Z"),
      randomId: () => "random",
      plan,
      createTransport: vi.fn(() => ({ send: vi.fn() })),
      createDispatcher: vi.fn(() => ({ dispatch })),
    });
    const runtime = createCloudflareRuntimeContext(
      validTestEnvironment(),
      {} as ExecutionContext,
    );

    await expect(
      scheduled({ scheduledTime: 123 } as ScheduledController, runtime),
    ).rejects.toBe(failure);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ leaseOwner: "cron:123:queued:random" }),
    );
  });
});
