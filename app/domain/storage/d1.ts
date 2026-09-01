export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown>;
}

export interface AssignmentMutation {
  id: string;
  expectedVersion: number;
  memberId: string;
  source: "reassignment" | "swap";
  actorMemberId: string;
  requestId: string;
  operationId: string;
  operationKind: "reassign" | "swap" | "correct";
  occurredAt: string;
}

const updateAssignmentSql = `UPDATE weekly_assignments
SET member_id = ?, version = version + 1, source = ?, actor_member_id = ?,
    request_id = ?, operation_id = ?, operation_kind = ?, occurred_at = ?
WHERE id = ? AND version = ?`;

export async function applyAssignmentMutations(
  database: D1DatabaseLike,
  mutations: readonly AssignmentMutation[],
): Promise<void> {
  if (mutations.length === 0) return;
  await database.batch(
    mutations.map((mutation) =>
      database
        .prepare(updateAssignmentSql)
        .bind(
          mutation.memberId,
          mutation.source,
          mutation.actorMemberId,
          mutation.requestId,
          mutation.operationId,
          mutation.operationKind,
          mutation.occurredAt,
          mutation.id,
          mutation.expectedVersion,
        ),
    ),
  );
}

export async function claimReminderOutbox(
  database: D1DatabaseLike,
  input: {
    now: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    limit: number;
  },
): Promise<void> {
  await database
    .prepare(
      `UPDATE reminder_outbox
      SET status = 'leased', lease_owner = ?, lease_expires_at = ?, attempt_count = attempt_count + 1
      WHERE id IN (
        SELECT id FROM reminder_outbox
        WHERE available_at <= ? AND (status = 'pending' OR (status = 'leased' AND lease_expires_at <= ?))
        ORDER BY available_at, id LIMIT ?
      )`,
    )
    .bind(
      input.leaseOwner,
      input.leaseExpiresAt,
      input.now,
      input.now,
      input.limit,
    )
    .run();
}

export interface MigrationStep {
  name: string;
  execute(database: D1DatabaseLike): Promise<void>;
}

export async function applyPendingMigrations(
  database: D1DatabaseLike,
  migrations: readonly MigrationStep[],
): Promise<void> {
  const applied = await database
    .prepare("SELECT name FROM d1_migrations ORDER BY name")
    .all<{ name: string }>();
  const names = new Set(applied.results.map(({ name }) => name));
  for (const migration of migrations) {
    if (names.has(migration.name)) continue;
    await migration.execute(database);
    await database
      .prepare("INSERT INTO d1_migrations (name) VALUES (?)")
      .bind(migration.name)
      .run();
  }
}
