import { createContext } from "react-router";

import {
  parseRuntimeConfig,
  type AppEnvironment,
  type RuntimeConfig,
} from "./environment";

export interface CloudflareRuntimeContext {
  env: AppEnvironment;
  executionContext: ExecutionContext;
  config: RuntimeConfig;
}

export const cloudflareContext = createContext<CloudflareRuntimeContext>();

export function createCloudflareRuntimeContext(
  env: AppEnvironment,
  executionContext: ExecutionContext,
): CloudflareRuntimeContext {
  return {
    env,
    executionContext,
    config: parseRuntimeConfig(env),
  };
}
