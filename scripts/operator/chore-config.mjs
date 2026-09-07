const choreIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumChoreCount = 50;
const maximumInstructionsLength = 5000;

export const weekdays = new Map([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
]);

/** @param {string} value */
function isValidLocalDate(value) {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** @param {string} value */
function weekdayOfDate(value) {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

/**
 * The default is intentionally the configuration already used by the first
 * production bootstrap. Keeping it here makes old private input documents and
 * the deployed household's verification contract backwards compatible.
 *
 * @param {readonly {id: string}[]} members
 */
export function defaultChoreConfig(members) {
  const memberIds = members.map(({ id }) => id);
  return [
    {
      id: "trash",
      name: "Trash",
      instructions: "Take the trash out and replace bags.",
      ownershipStartWeekday: "friday",
      rotation: {
        id: "rotation-trash-2026-08-28",
        effectiveFrom: "2026-08-28",
        offset: 0,
        memberIds: [...memberIds],
      },
    },
    {
      id: "dishwasher",
      name: "Dishwasher",
      instructions: "Empty the completed dishwasher.",
      ownershipStartWeekday: "monday",
      rotation: {
        id: "rotation-dishwasher-2026-08-31",
        effectiveFrom: "2026-08-31",
        offset: 2,
        memberIds: [...memberIds],
      },
    },
  ];
}

/**
 * @param {unknown} chores
 * @param {readonly {id: string}[]} members
 * @param {{allowDerivedWeekday?: boolean}} [options]
 * @returns {Array<{id: string, name: string, instructions: string, ownershipStartWeekday: string, ownershipStartWeekdayNumber: number, rotation: {id: string, effectiveFrom: string, offset: number, memberIds: string[]}}>}
 */
export function validateChoreConfig(chores, members, options = {}) {
  /** @type {string[]} */
  const failures = [];
  if (
    !Array.isArray(chores) ||
    chores.length === 0 ||
    chores.length > maximumChoreCount
  ) {
    throw new Error("Invalid operator chore configuration: bounded chore list");
  }

  const memberIds = members.map(({ id }) => id);
  const memberIdSet = new Set(memberIds);
  const choreIds = new Set();
  const names = new Set();
  const rotationIds = new Set();
  /** @type {Array<{id: string, name: string, instructions: string, ownershipStartWeekday: string, ownershipStartWeekdayNumber: number, rotation: {id: string, effectiveFrom: string, offset: number, memberIds: string[]}}>} */
  const validated = [];

  for (const candidate of chores) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      failures.push("chore shape");
      continue;
    }
    const chore = /** @type {Record<string, unknown>} */ (candidate);
    const choreFields = Object.keys(chore).sort().join(",");
    if (
      ![
        "id,instructions,name,ownershipStartWeekday,rotation",
        ...(options.allowDerivedWeekday
          ? [
              "id,instructions,name,ownershipStartWeekday,ownershipStartWeekdayNumber,rotation",
            ]
          : []),
      ].includes(choreFields)
    ) {
      failures.push("chore fields");
    }

    const id = chore.id;
    if (
      typeof id !== "string" ||
      id.length > 64 ||
      !choreIdPattern.test(id) ||
      choreIds.has(id)
    ) {
      failures.push("unique safe chore id");
    } else {
      choreIds.add(id);
    }

    const name = chore.name;
    if (
      typeof name !== "string" ||
      name !== name.trim() ||
      name.length === 0 ||
      name.length > 100 ||
      names.has(name)
    ) {
      failures.push("unique trimmed chore name");
    } else {
      names.add(name);
    }

    const instructions = chore.instructions;
    if (
      typeof instructions !== "string" ||
      instructions !== instructions.trim() ||
      instructions.length === 0 ||
      instructions.length > maximumInstructionsLength
    ) {
      failures.push("chore instructions");
    }

    const ownershipStartWeekday = chore.ownershipStartWeekday;
    const ownershipStartWeekdayNumber =
      typeof ownershipStartWeekday === "string"
        ? weekdays.get(ownershipStartWeekday)
        : undefined;
    if (ownershipStartWeekdayNumber === undefined) {
      failures.push("chore ownership weekday");
    }

    const rotation = chore.rotation;
    if (
      rotation === null ||
      typeof rotation !== "object" ||
      Array.isArray(rotation)
    ) {
      failures.push("rotation shape");
      continue;
    }
    const rotationInput = /** @type {Record<string, unknown>} */ (rotation);
    if (
      Object.keys(rotationInput).sort().join(",") !==
      "effectiveFrom,id,memberIds,offset"
    ) {
      failures.push("rotation fields");
    }

    const rotationId = rotationInput.id;
    if (
      typeof rotationId !== "string" ||
      rotationId.length > 100 ||
      !choreIdPattern.test(rotationId) ||
      rotationIds.has(rotationId)
    ) {
      failures.push("unique safe rotation id");
    } else {
      rotationIds.add(rotationId);
    }

    const effectiveFrom = rotationInput.effectiveFrom;
    if (
      typeof effectiveFrom !== "string" ||
      !isValidLocalDate(effectiveFrom) ||
      (ownershipStartWeekdayNumber !== undefined &&
        weekdayOfDate(effectiveFrom) !== ownershipStartWeekdayNumber)
    ) {
      failures.push("rotation effective date");
    }

    const offset = rotationInput.offset;
    if (
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < -1_000_000 ||
      offset > 1_000_000
    ) {
      failures.push("rotation offset");
    }

    const rotationMemberIds = rotationInput.memberIds;
    if (
      !Array.isArray(rotationMemberIds) ||
      rotationMemberIds.length !== memberIds.length ||
      new Set(rotationMemberIds).size !== memberIds.length ||
      rotationMemberIds.some(
        (memberId) =>
          typeof memberId !== "string" || !memberIdSet.has(memberId),
      )
    ) {
      failures.push("rotation member order");
    }

    if (
      typeof id === "string" &&
      typeof name === "string" &&
      typeof instructions === "string" &&
      typeof ownershipStartWeekday === "string" &&
      ownershipStartWeekdayNumber !== undefined &&
      typeof rotationId === "string" &&
      typeof effectiveFrom === "string" &&
      typeof offset === "number" &&
      Array.isArray(rotationMemberIds)
    ) {
      validated.push({
        id,
        name,
        instructions,
        ownershipStartWeekday,
        ownershipStartWeekdayNumber,
        rotation: {
          id: rotationId,
          effectiveFrom,
          offset,
          memberIds: [...rotationMemberIds],
        },
      });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Invalid operator chore configuration: ${[...new Set(failures)].sort().join(", ")}`,
    );
  }
  return validated;
}

/**
 * @param {{chores?: unknown, members: readonly {id: string}[]}} input
 */
export function choreConfigForInput(input) {
  return validateChoreConfig(
    input.chores === undefined
      ? defaultChoreConfig(input.members)
      : input.chores,
    input.members,
  );
}
