import { APIError, betterAuth, type BetterAuthOptions } from "better-auth";

import type { RuntimeConfig } from "../runtime/environment";
import {
  AuthorizationError,
  createRequestAuthorizer,
  normalizeEmail,
  type AllowlistLookup,
  type AuthorizedMember,
  type SessionIdentity,
} from "./access";
import {
  createD1AuthBinding,
  createD1AllowlistLookup,
  type D1AuthBinding,
} from "./d1-allowlist";
import { MutationOriginError, requireExactMutationOrigin } from "./origin";

export interface BetterAuthService {
  handler(request: Request): Promise<Response>;
  readSession(request: Request): Promise<SessionIdentity | null>;
  options?: BetterAuthOptions;
  ready?: Promise<void>;
}

export type BetterAuthFactory = (
  database: D1Database,
  config: RuntimeConfig,
  lookup: AllowlistLookup,
) => BetterAuthService;

export function createBetterAuthOptions(
  database: D1Database,
  config: RuntimeConfig,
  lookup: AllowlistLookup,
  binding: D1AuthBinding = createD1AuthBinding(database),
) {
  function bindingFailure(error: unknown): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      error.reason === "denied"
    ) {
      throw new APIError("FORBIDDEN", {
        message: "Account authorization denied",
      });
    }
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: "Account authorization unavailable",
    });
  }

  return {
    appName: "Chorotate",
    baseURL: config.canonicalOrigin,
    basePath: "/api/auth",
    secret: config.secrets.betterAuthSecret,
    database,
    trustedOrigins: [config.canonicalOrigin],
    socialProviders: {
      google: {
        clientId: config.secrets.googleClientId,
        clientSecret: config.secrets.googleClientSecret,
      },
    },
    session: {
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      skipStateCookieCheck: false,
      storeAccountCookie: false,
    },
    advanced: {
      useSecureCookies: true,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      cookiePrefix: "chorotate",
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            try {
              await binding.requireEligible(normalizeEmail(user.email));
            } catch (error) {
              bindingFailure(error);
            }
          },
          async after(user) {
            try {
              await binding.claim(normalizeEmail(user.email), user.id);
            } catch (error) {
              bindingFailure(error);
            }
          },
        },
      },
      account: {
        create: {
          async before(account) {
            try {
              await binding.reconcileAccountUser(account.userId);
            } catch (error) {
              bindingFailure(error);
            }
          },
        },
      },
      session: {
        create: {
          async before(session) {
            try {
              await binding.requireBoundUser(session.userId);
            } catch (error) {
              bindingFailure(error);
            }
          },
        },
      },
    },
    logger: { disabled: true },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

export function createBetterAuth(
  database: D1Database,
  config: RuntimeConfig,
  lookup: AllowlistLookup,
): BetterAuthService & { options: BetterAuthOptions } {
  const options = createBetterAuthOptions(database, config, lookup);
  const auth = betterAuth(options);

  return {
    options,
    ready: auth.$context.then(() => undefined),
    handler: auth.handler,
    async readSession(request) {
      const result = await auth.api.getSession({
        headers: request.headers,
        query: {
          disableCookieCache: true,
          disableRefresh: true,
        },
      });
      if (result === null) return null;
      return {
        sessionId: result.session.id,
        userId: result.user.id,
        email: result.user.email,
        imageUrl: result.user.image ?? undefined,
      };
    },
  };
}

const defaultFactory: BetterAuthFactory = createBetterAuth;

function safeAuthResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function isExactOriginSignOut(
  request: Request,
  canonicalOrigin: string,
): boolean {
  const url = new URL(request.url);
  return (
    request.method === "POST" &&
    url.origin === canonicalOrigin &&
    url.pathname === "/api/auth/sign-out" &&
    request.headers.get("origin") === canonicalOrigin
  );
}

export async function handleAuthRequest(
  request: Request,
  database: D1Database,
  config: RuntimeConfig,
  dependencies: {
    factory?: BetterAuthFactory;
    lookup?: AllowlistLookup;
  } = {},
): Promise<Response> {
  try {
    requireExactMutationOrigin(request, config.canonicalOrigin);
    const lookup = dependencies.lookup ?? createD1AllowlistLookup(database);
    const auth = (dependencies.factory ?? defaultFactory)(
      database,
      config,
      lookup,
    );
    const authorizer = createRequestAuthorizer({
      readSession: auth.readSession,
      lookup,
    });

    // A removed member must be able to clear the database session and cookie,
    // but this narrow exception never authorizes any other auth endpoint.
    if (new URL(request.url).pathname === "/api/auth/sign-out") {
      if (!isExactOriginSignOut(request, config.canonicalOrigin)) {
        return safeAuthResponse(403, "Mutation origin denied");
      }
      return await auth.handler(request);
    }

    // Anonymous OAuth protocol requests proceed to Better Auth. Any request
    // carrying a valid session is rechecked against D1 before the API handles it.
    await authorizer.authorizedMemberOrNull(request);
    return await auth.handler(request);
  } catch (error) {
    if (error instanceof MutationOriginError) {
      return safeAuthResponse(403, "Mutation origin denied");
    }
    if (error instanceof AuthorizationError) {
      return safeAuthResponse(error.status, error.message);
    }
    return safeAuthResponse(503, "Authentication unavailable");
  }
}

/**
 * Route-local authorization helper. Loaders and actions call this directly;
 * authorization never depends on middleware-provided identity headers.
 */
export async function requireAuthorizedMember(
  request: Request,
  database: D1Database,
  config: RuntimeConfig,
): Promise<AuthorizedMember> {
  requireExactMutationOrigin(request, config.canonicalOrigin);
  const lookup = createD1AllowlistLookup(database);
  const auth = createBetterAuth(database, config, lookup);
  return createRequestAuthorizer({
    readSession: auth.readSession,
    lookup,
  }).requireAuthorizedMember(request);
}
