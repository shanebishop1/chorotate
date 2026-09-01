import type { Route } from "./+types/api.auth";
import { handleAuthRequest } from "../auth/better-auth";
import { cloudflareContext } from "../runtime/context";

function handle({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  const runtime = context.get(cloudflareContext);
  return handleAuthRequest(request, runtime.env.DB, runtime.config);
}

export function loader(args: Route.LoaderArgs) {
  return handle(args);
}

export function action(args: Route.ActionArgs) {
  return handle(args);
}
