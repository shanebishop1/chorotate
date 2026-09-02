export interface AuthorizedMember {
  id: string;
  householdId: string;
  displayName: string;
  imageUrl?: string;
}

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  email: string;
  imageUrl?: string;
}

export type AllowlistLookup = (
  normalizedEmail: string,
  authUserId: string,
) => Promise<AuthorizedMember | null>;

export type SessionReader = (
  request: Request,
) => Promise<SessionIdentity | null>;

export class AuthorizationError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super(
      status === 401
        ? "Authentication required"
        : status === 403
          ? "Access denied"
          : "Authorization unavailable",
    );
    this.name = "AuthorizationError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createRequestAuthorizer(dependencies: {
  readSession: SessionReader;
  lookup: AllowlistLookup;
}) {
  async function authorizedMemberOrNull(
    request: Request,
  ): Promise<AuthorizedMember | null> {
    let identity: SessionIdentity | null;
    try {
      identity = await dependencies.readSession(request);
    } catch {
      throw new AuthorizationError(503);
    }

    if (identity === null) return null;

    const normalizedEmail =
      typeof identity.email === "string" ? normalizeEmail(identity.email) : "";
    if (
      typeof identity.userId !== "string" ||
      identity.userId.length === 0 ||
      typeof identity.email !== "string" ||
      identity.email.length === 0 ||
      identity.email !== normalizedEmail
    ) {
      throw new AuthorizationError(403);
    }

    let member: AuthorizedMember | null;
    try {
      member = await dependencies.lookup(normalizedEmail, identity.userId);
    } catch {
      throw new AuthorizationError(503);
    }

    if (member === null) throw new AuthorizationError(403);
    const imageUrl = trustedGoogleImage(identity.imageUrl);
    return imageUrl ? { ...member, imageUrl } : member;
  }

  return {
    authorizedMemberOrNull,
    async requireAuthorizedMember(request: Request): Promise<AuthorizedMember> {
      const member = await authorizedMemberOrNull(request);
      if (member === null) throw new AuthorizationError(401);
      return member;
    },
  };
}

export function trustedGoogleImage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "lh3.googleusercontent.com"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
