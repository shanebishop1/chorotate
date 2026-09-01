import {
  normalizeEmail,
  type AllowlistLookup,
  type AuthorizedMember,
} from "./access";

// This query is the auth lane's schema contract with the D1 migration lane.
// LIMIT 2 lets authorization fail closed if a uniqueness invariant is broken.
export const activeAllowlistMemberQuery = `
  SELECT
    m.id AS member_id,
    m.household_id AS household_id,
    m.display_name AS display_name
  FROM allowlisted_identities AS ai
  INNER JOIN members AS m ON m.id = ai.member_id
  WHERE ai.email_normalized = ?1
    AND ai.active = 1
    AND m.active = 1
    AND ai.auth_user_id = ?2
  LIMIT 2
`;

export const eligibleUnboundAllowlistIdentityQuery = `
  SELECT
    m.id AS member_id,
    m.household_id AS household_id,
    m.display_name AS display_name
  FROM allowlisted_identities AS ai
  INNER JOIN members AS m ON m.id = ai.member_id
  WHERE ai.email_normalized = ?1
    AND ai.active = 1
    AND m.active = 1
    AND ai.auth_user_id IS NULL
  LIMIT 2
`;

// One statement performs the compare-and-set. The scalar subquery returns an
// id only when the active normalized identity is globally unambiguous.
export const claimActiveAllowlistIdentityQuery = `
  UPDATE allowlisted_identities
  SET auth_user_id = ?2
  WHERE id = (
    SELECT CASE WHEN count(*) = 1 THEN min(ai.id) END
    FROM allowlisted_identities AS ai
    INNER JOIN members AS m ON m.id = ai.member_id
    WHERE ai.email_normalized = ?1
      AND ai.active = 1
      AND m.active = 1
  )
    AND (auth_user_id IS NULL OR auth_user_id = ?2)
  RETURNING
    member_id,
    household_id,
    (SELECT display_name FROM members WHERE id = member_id) AS display_name
`;

export const authUserByIdQuery = `
  SELECT id AS auth_user_id, email
  FROM "user"
  WHERE id = ?1
  LIMIT 2
`;

interface MemberRow {
  member_id: unknown;
  household_id: unknown;
  display_name: unknown;
}

interface AuthUserRow {
  auth_user_id: unknown;
  email: unknown;
}

export class AuthBindingError extends Error {
  constructor(readonly reason: "denied" | "unavailable") {
    super(
      reason === "denied" ? "Auth binding denied" : "Auth binding unavailable",
    );
    this.name = "AuthBindingError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseMember(row: MemberRow): AuthorizedMember {
  if (
    !isNonEmptyString(row.member_id) ||
    !isNonEmptyString(row.household_id) ||
    !isNonEmptyString(row.display_name)
  ) {
    throw new Error("Allowlist lookup failed");
  }

  return {
    id: row.member_id,
    householdId: row.household_id,
    displayName: row.display_name,
  };
}

export function createD1AllowlistLookup(database: D1Database): AllowlistLookup {
  return async (normalizedEmail, authUserId) => {
    if (
      normalizedEmail.length === 0 ||
      normalizedEmail !== normalizeEmail(normalizedEmail) ||
      authUserId.length === 0
    ) {
      throw new Error("Allowlist lookup failed");
    }
    let result: D1Result<MemberRow>;
    try {
      result = await database
        .prepare(activeAllowlistMemberQuery)
        .bind(normalizedEmail, authUserId)
        .all<MemberRow>();
    } catch {
      throw new Error("Allowlist lookup failed");
    }

    if (!result.success || result.results.length > 1) {
      throw new Error("Allowlist lookup failed");
    }
    if (result.results.length === 0) return null;
    return parseMember(result.results[0]);
  };
}

async function rowsFor<Row>(
  database: D1Database,
  query: string,
  bindings: readonly unknown[],
): Promise<Row[]> {
  try {
    const result = await database
      .prepare(query)
      .bind(...bindings)
      .all<Row>();
    if (!result.success) throw new Error("D1 statement failed");
    return result.results;
  } catch {
    throw new AuthBindingError("unavailable");
  }
}

export interface D1AuthBinding {
  requireEligible(normalizedEmail: string): Promise<AuthorizedMember>;
  claim(normalizedEmail: string, authUserId: string): Promise<AuthorizedMember>;
  reconcileAccountUser(authUserId: string): Promise<AuthorizedMember>;
  requireBoundUser(authUserId: string): Promise<AuthorizedMember>;
}

export function createD1AuthBinding(database: D1Database): D1AuthBinding {
  const lookup = createD1AllowlistLookup(database);

  async function readAuthUser(authUserId: string): Promise<AuthUserRow> {
    if (authUserId.length === 0) throw new AuthBindingError("denied");
    const rows = await rowsFor<AuthUserRow>(database, authUserByIdQuery, [
      authUserId,
    ]);
    if (rows.length !== 1) throw new AuthBindingError("denied");
    const row = rows[0];
    if (
      !isNonEmptyString(row.auth_user_id) ||
      row.auth_user_id !== authUserId ||
      !isNonEmptyString(row.email) ||
      row.email !== normalizeEmail(row.email)
    ) {
      throw new AuthBindingError("denied");
    }
    return row;
  }

  async function claim(
    normalizedEmail: string,
    authUserId: string,
  ): Promise<AuthorizedMember> {
    if (
      normalizedEmail.length === 0 ||
      normalizedEmail !== normalizeEmail(normalizedEmail) ||
      authUserId.length === 0
    ) {
      throw new AuthBindingError("denied");
    }
    const rows = await rowsFor<MemberRow>(
      database,
      claimActiveAllowlistIdentityQuery,
      [normalizedEmail, authUserId],
    );
    if (rows.length !== 1) throw new AuthBindingError("denied");
    try {
      return parseMember(rows[0]);
    } catch {
      throw new AuthBindingError("unavailable");
    }
  }

  return {
    async requireEligible(normalizedEmail) {
      if (
        normalizedEmail.length === 0 ||
        normalizedEmail !== normalizeEmail(normalizedEmail)
      ) {
        throw new AuthBindingError("denied");
      }
      const rows = await rowsFor<MemberRow>(
        database,
        eligibleUnboundAllowlistIdentityQuery,
        [normalizedEmail],
      );
      if (rows.length !== 1) throw new AuthBindingError("denied");
      try {
        return parseMember(rows[0]);
      } catch {
        throw new AuthBindingError("unavailable");
      }
    },
    claim,
    async reconcileAccountUser(authUserId) {
      const user = await readAuthUser(authUserId);
      return claim(user.email as string, authUserId);
    },
    async requireBoundUser(authUserId) {
      const user = await readAuthUser(authUserId);
      let member: AuthorizedMember | null;
      try {
        member = await lookup(user.email as string, authUserId);
      } catch {
        throw new AuthBindingError("unavailable");
      }
      if (member === null) throw new AuthBindingError("denied");
      return member;
    },
  };
}
