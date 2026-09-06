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
    const database = runtime.env.DB;
    const transport = (options.createTransport ?? createTextbeltTransport)({
      apiKey: runtime.config.secrets.textbeltApiKey,
      timeoutMilliseconds: runtime.config.reminders.providerTimeoutMilliseconds,
    });
    const dispatcher = (options.createDispatcher ?? createReminderDispatcher)(
      database,
      transport,
    );
    const dispatch = (stage: "queued" | "planned") =>
      dispatcher.dispatch({
        now: clock(),
        leaseOwner: `cron:${controller.scheduledTime}:${stage}:${options.randomId?.() ?? crypto.randomUUID()}`,
        batchSize: runtime.config.reminders.batchSize,
        leaseMilliseconds: runtime.config.reminders.leaseMilliseconds,
        providerTimeoutMilliseconds:
          runtime.config.reminders.providerTimeoutMilliseconds,
      });

    // Durable due work must not wait behind potentially expensive planning.
    await dispatch("queued");
    await (options.plan ?? planReminders)(database, { now: clock() });
    await dispatch("planned");
  };
}

export const dispatchScheduledReminders = createScheduledReminderDispatcher();
