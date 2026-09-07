import type { RuntimeConfig } from "../runtime/environment";
import type { SessionIdentity } from "./access";

/** This value is intentionally not configurable by a request or an env var. */
export const localDevelopmentUserId = "local-dev-user";
export const localDevelopmentSessionCookie = "chorotate.local_session";
export const localDevelopmentSessionMaxAge = 60 * 60 * 24 * 7;

// Vite replaces import.meta.env.DEV at build time. A production build therefore
// cannot turn this feature on by setting a Worker variable.
export const localDevelopmentBuildEnabled = import.meta.env.DEV;

const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const localDevelopmentIdentityQuery = `
  SELECT
    ai.auth_user_id AS auth_user_id,
    u.email AS email
  FROM allowlisted_identities AS ai
  INNER JOIN members AS m ON m.id = ai.member_id
  INNER JOIN "user" AS u ON u.id = ai.auth_user_id
  WHERE ai.auth_user_id = ?1
    AND ai.email_normalized = u.email
    AND ai.active = 1
    AND m.active = 1
  LIMIT 2
`;

export const localDevelopmentSessionQuery = `
  SELECT
    s.id AS session_id,
    s.userId AS user_id,
    s.expiresAt AS expires_at,
    u.email AS email,
    u.image AS image
  FROM "session" AS s
  INNER JOIN "user" AS u ON u.id = s.userId
  WHERE s.token = ?1
    AND s.expiresAt > ?2
  LIMIT 2
`;

interface LocalIdentityRow {
  auth_user_id: unknown;
  email: unknown;
}

interface LocalSessionRow {
  session_id: unknown;
  user_id: unknown;
  expires_at: unknown;
  email: unknown;
  image: unknown;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== localDevelopmentSessionCookie) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function isLoopbackUrl(request: Request, config: RuntimeConfig): boolean {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    return (
      url.origin === config.canonicalOrigin &&
      url.protocol === "http:" &&
      loopbackHostnames.has(url.hostname) &&
      (host === null || host === url.host)
    );
  } catch {
    return false;
  }
}

export function isLocalDevelopmentRequest(
  request: Request,
  config: RuntimeConfig,
  options: { requireOrigin?: boolean } = {},
  buildEnabled = localDevelopmentBuildEnabled,
): boolean {
  if (
    !buildEnabled ||
    !config.localAuthEnabled ||
    config.applicationEnvironment !== "local" ||
    !isLoopbackUrl(request, config)
  ) {
    return false;
  }
  return (
    options.requireOrigin !== true ||
    request.headers.get("origin") === config.canonicalOrigin
  );
}

function localAuthResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function localSessionCookie(value: string, maxAge: number): string {
  return `${localDevelopmentSessionCookie}=${encodeURIComponent(value)}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax`;
}

async function localIdentityExists(database: D1Database): Promise<boolean> {
  const result = await database
    .prepare(localDevelopmentIdentityQuery)
    .bind(localDevelopmentUserId)
    .all<LocalIdentityRow>();
  return result.success && result.results.length === 1;
}

export async function readLocalDevelopmentSession(
  request: Request,
  database: D1Database,
  config: RuntimeConfig,
): Promise<SessionIdentity | null> {
  if (!isLocalDevelopmentRequest(request, config)) return null;
  const token = cookieValue(request);
  if (token === null || token.length === 0) return null;
  const result = await database
    .prepare(localDevelopmentSessionQuery)
    .bind(token, Date.now())
    .all<LocalSessionRow>();
  if (!result.success || result.results.length > 1) {
    throw new Error("Local development session lookup failed");
  }
  const row = result.results[0];
  if (
    row === undefined ||
    !nonEmptyString(row.session_id) ||
    row.user_id !== localDevelopmentUserId ||
    !nonEmptyString(row.email) ||
    row.email !== row.email.trim().toLowerCase()
  ) {
    return null;
  }
  return {
    sessionId: row.session_id,
    userId: localDevelopmentUserId,
    email: row.email,
    ...(nonEmptyString(row.image) ? { imageUrl: row.image } : {}),
  };
}

export async function handleLocalDevelopmentAuthRequest(
  request: Request,
  database: D1Database,
  config: RuntimeConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const signOut = url.pathname === "/api/auth/local/sign-out";
  const signIn = url.pathname === "/api/auth/local";
  if (
    (!signIn && !signOut) ||
    request.method.toUpperCase() !== "POST" ||
    !isLocalDevelopmentRequest(request, config, { requireOrigin: true })
  ) {
    return localAuthResponse(403, "Local development authentication denied");
  }

  if (signOut) {
    const token = cookieValue(request);
    if (token !== null && token.length > 0) {
      await database
        .prepare('DELETE FROM "session" WHERE token = ?1')
        .bind(token)
        .run();
    }
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": localSessionCookie("", 0) },
    });
  }

  if (!(await localIdentityExists(database))) {
    return localAuthResponse(503, "Local development identity unavailable");
  }

  const sessionId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await database
    .prepare(
      'INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?1, ?2, ?3, ?4, ?4, ?5)',
    )
    .bind(
      sessionId,
      now + localDevelopmentSessionMaxAge * 1000,
      token,
      now,
      localDevelopmentUserId,
    )
    .run();
  if (!result.success)
    return localAuthResponse(503, "Authentication unavailable");

  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": localSessionCookie(token, localDevelopmentSessionMaxAge),
    },
  });
}
