import { createRequestHandler, RouterContextProvider } from "react-router";

import {
  cloudflareContext,
  createCloudflareRuntimeContext,
  type CloudflareRuntimeContext,
} from "../app/runtime/context";
import type { AppEnvironment } from "../app/runtime/environment";
import { dispatchScheduledReminders } from "../app/domain/reminders/scheduled";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export type ScheduledDispatcher = (
  controller: ScheduledController,
  runtime: CloudflareRuntimeContext,
) => Promise<void>;

export function createWorker(
  dispatchScheduled: ScheduledDispatcher = dispatchScheduledReminders,
  reportScheduledFailure: (message: string) => void = console.error,
): ExportedHandler<AppEnvironment> {
  return {
    async fetch(request, env, ctx) {
      const routerContext = new RouterContextProvider();
      routerContext.set(
        cloudflareContext,
        createCloudflareRuntimeContext(env, ctx),
      );
      return requestHandler(request, routerContext);
    },
    async scheduled(controller, env, ctx) {
      try {
        await dispatchScheduled(
          controller,
          createCloudflareRuntimeContext(env, ctx),
        );
      } catch {
        reportScheduledFailure("Reminder scheduled dispatch failed");
        throw new Error("Reminder scheduled dispatch failed");
      }
    },
  };
}

export default createWorker();
