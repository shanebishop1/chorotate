export interface DutyCredit {
  memberId: string;
  choreId: string;
  /** Household-local days of responsibility, including short bridge periods. */
  days: number;
}

/** Choose the least historically imbalanced phase of a shared cyclic rotation.
 * Every candidate gives each member one chore per week and every chore exactly
 * once per cycle. Historical credits determine which duties come first; they
 * are never rewritten or treated as a claim that a chore was completed.
 */
export function planBalancedRotation(input: {
  memberIds: readonly string[];
  choreIds: readonly string[];
  history: readonly DutyCredit[];
  previousOwners?: Readonly<Record<string, string>>;
}): {
  offsets: Record<string, number>;
  imbalance: number;
  repeatedDuties: number;
} {
  const count = input.memberIds.length;
  if (
    count < 1 ||
    count > 8 ||
    input.choreIds.length !== count ||
    new Set(input.memberIds).size !== count ||
    new Set(input.choreIds).size !== count ||
    [...input.memberIds, ...input.choreIds].some(
      (id) => !id || id !== id.trim(),
    ) ||
    input.history.length > 10000
  ) {
    throw new RangeError(
      "Balanced rotation requires equally sized unique member and chore lists (1-8)",
    );
  }
  const credits = input.choreIds.map(() => Array<number>(count).fill(0));
  for (const credit of input.history) {
    const chore = input.choreIds.indexOf(credit.choreId);
    const member = input.memberIds.indexOf(credit.memberId);
    if (
      chore < 0 ||
      member < 0 ||
      !Number.isSafeInteger(credit.days) ||
      credit.days < 0 ||
      credit.days > 100000
    ) {
      throw new RangeError("Invalid historical duty credit");
    }
    credits[chore]![member]! += credit.days;
  }
  let best:
    | { offsets: number[]; imbalance: number; repeatedDuties: number }
    | undefined;
  function consider(offsets: number[]) {
    const projected = credits.map((row) => [...row]);
    let imbalance = 0;
    for (let week = 0; week < count; week += 1) {
      for (let chore = 0; chore < count; chore += 1) {
        const row = projected[chore]!;
        row[(offsets[chore]! + week) % count]! += 7;
        const sum = row.reduce((a, b) => a + b, 0);
        imbalance += count * row.reduce((a, b) => a + b * b, 0) - sum * sum;
      }
    }
    const repeatedDuties = input.choreIds.reduce(
      (n, chore, index) =>
        n +
        Number(
          input.previousOwners?.[chore] === input.memberIds[offsets[index]!],
        ),
      0,
    );
    if (
      !best ||
      imbalance < best.imbalance ||
      (imbalance === best.imbalance && repeatedDuties < best.repeatedDuties)
    ) {
      best = { offsets: [...offsets], imbalance, repeatedDuties };
    }
  }
  function enumerate(prefix: number[], remaining: number[]) {
    if (!remaining.length) {
      consider(prefix);
      return;
    }
    for (const offset of remaining)
      enumerate(
        [...prefix, offset],
        remaining.filter((n) => n !== offset),
      );
  }
  enumerate(
    [],
    Array.from({ length: count }, (_, i) => i),
  );
  if (!best) throw new Error("Balanced rotation unavailable");
  return {
    offsets: Object.fromEntries(
      input.choreIds.map((id, i) => [id, best!.offsets[i]!]),
    ),
    imbalance: best.imbalance,
    repeatedDuties: best.repeatedDuties,
  };
}
