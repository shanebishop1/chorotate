import { describe, expect, it, vi } from "vitest";

import { validTestEnvironment } from "../app/runtime/test-fixtures";
import { createWorker } from "./app";

describe("Worker scheduled boundary", () => {
  it("is callable through the dispatcher seam", async () => {
    const dispatch = vi.fn(async () => undefined);
    const worker = createWorker(dispatch);
    const controller = {
      cron: "*/15 * * * *",
      scheduledTime: 0,
      noRetry: vi.fn(),
    } as unknown as ScheduledController;
    const executionContext = {} as ExecutionContext;

    await worker.scheduled?.(
      controller,
      validTestEnvironment(),
      executionContext,
    );

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      controller,
      expect.objectContaining({ executionContext }),
    );
  });

  it("bounds and sanitizes scheduled failures", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("token-secret owner@example.invalid raw provider body");
    });
    const report = vi.fn();
    const worker = createWorker(dispatch, report);
    const controller = {
      cron: "*/15 * * * *",
      scheduledTime: 0,
      noRetry: vi.fn(),
    } as unknown as ScheduledController;

    await expect(
      worker.scheduled?.(
        controller,
        validTestEnvironment(),
        {} as ExecutionContext,
      ),
    ).rejects.toThrow("Reminder scheduled dispatch failed");

    expect(controller.noRetry).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("Reminder scheduled dispatch failed");
    expect(JSON.stringify(report.mock.calls)).not.toContain("token-secret");
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      "owner@example.invalid",
    );
  });
});
