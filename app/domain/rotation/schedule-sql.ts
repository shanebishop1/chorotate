/** SQL fragments accept only internal aliases, never request input. */
export function periodWeekdaySql(
  alias: string,
  dateColumn = "local_period_start",
): string {
  return `COALESCE((SELECT COALESCE(rc.ownership_start_weekday, c.ownership_start_weekday)
    FROM rotation_configs rc JOIN chores c ON c.id=rc.chore_id AND c.household_id=rc.household_id
    WHERE rc.household_id=${alias}.household_id AND rc.chore_id=${alias}.chore_id
      AND rc.effective_from<=${alias}.${dateColumn}
    ORDER BY rc.effective_from DESC LIMIT 1),
    (SELECT ownership_start_weekday FROM chores WHERE id=${alias}.chore_id AND household_id=${alias}.household_id))`;
}

export function periodEndSql(alias: string): string {
  return `min(date(${alias}.local_period_start, '+6 days'),
    COALESCE((SELECT date(min(rc.effective_from), '-1 day') FROM rotation_configs rc
      WHERE rc.household_id=${alias}.household_id AND rc.chore_id=${alias}.chore_id
        AND rc.effective_from>${alias}.local_period_start), date(${alias}.local_period_start, '+6 days')))`;
}

export function activeAssignmentSql(alias: string, idColumn = "id"): string {
  return `NOT EXISTS (SELECT 1 FROM assignment_schedule_retirements retired WHERE retired.assignment_id=${alias}.${idColumn})`;
}
