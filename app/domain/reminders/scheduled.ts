import type { CloudflareRuntimeContext } from "../../runtime/context";
import { createReminderDispatcher } from "./dispatcher";
import { planReminders } from "./planner";
import { createTextbeltTransport } from "./textbelt";

interface ScheduledReminderOptions {
  now?: () => Date;
  randomId?: () => string;
  plan?: typeof planReminders;
  createTransport?: typeof createTextbeltTransport;
  createDispatcher?: typeof createReminderDispatcher;
}

export function createScheduledReminderDispatcher(
  options: ScheduledReminderOptions = {},
): (
  controller: ScheduledController,
  runtime: CloudflareRuntimeContext,
) => Promise<void> {
  return async (controller, runtime) => {
    if (!runtime.config.reminders.smsEnabled) return;
    const clock = options.now ?? (() => new Date());
    const planningTime = clock();
    const database = runtime.env.DB;
    await (options.plan ?? planReminders)(database, { now: planningTime });
    const transport = (options.createTransport ?? createTextbeltTransport)({
      timeoutMilliseconds: runtime.config.reminders.providerTimeoutMilliseconds,
    });
    await (options.createDispatcher ?? createReminderDispatcher)(
      database,
      transport,
    ).dispatch({
      // Planning can involve multiple D1 round trips. Start the lease from a
      // fresh timestamp immediately before claiming dispatch work.
      now: clock(),
      leaseOwner: `cron:${controller.scheduledTime}:${options.randomId?.() ?? crypto.randomUUID()}`,
      batchSize: runtime.config.reminders.batchSize,
      leaseMilliseconds: runtime.config.reminders.leaseMilliseconds,
      providerTimeoutMilliseconds:
        runtime.config.reminders.providerTimeoutMilliseconds,
    });
  };
}

export const dispatchScheduledReminders = createScheduledReminderDispatcher();
