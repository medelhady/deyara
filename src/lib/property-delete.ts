export type DeletionCandidate = {
  id: string;
  property_code: string | null;
};

export type DeletionOutcome = {
  id: string;
  code: string;
  deleted: boolean;
  reason?: string;
};

export type DeletionPlan = {
  /** Ids that passed every guard and may be deleted in one statement. */
  deletable: string[];
  /** A line for each id that will not be deleted, with the reason to show the admin. */
  refused: DeletionOutcome[];
};

/**
 * Decides which of the selected listings may be deleted.
 *
 * Kept apart from the route so it can be tested without a database, because the cost of the two
 * mistakes it can make is lopsided. Refusing too much wastes a click. Deleting a listing a renter
 * paid to contact destroys the record of that payment, and nothing brings it back.
 */
export function planPropertyDeletion(
  ids: string[],
  found: DeletionCandidate[],
  contactRequestPropertyIds: string[]
): DeletionPlan {
  const byId = new Map(found.map((property) => [String(property.id), property]));
  const requestCounts = new Map<string, number>();

  for (const propertyId of contactRequestPropertyIds) {
    const key = String(propertyId);
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  }

  const deletable: string[] = [];
  const refused: DeletionOutcome[] = [];

  // Duplicates are collapsed so one listing can never produce two report lines.
  for (const id of [...new Set(ids)]) {
    const property = byId.get(id);
    const code = property?.property_code ?? id.slice(0, 8);

    if (!property) {
      refused.push({ id, code, deleted: false, reason: "لم أجد هذا الإعلان — قد يكون حُذف بالفعل." });
      continue;
    }

    const asked = requestCounts.get(id) ?? 0;

    if (asked > 0) {
      refused.push({
        id,
        code,
        deleted: false,
        reason: `${asked} مستأجر طلبوا رقم مالكه ودفعوا مقابله. أخفِه بدل حذفه حتى يبقى سجل الدفع.`
      });
      continue;
    }

    deletable.push(id);
  }

  return { deletable, refused };
}

/** The label an admin recognises: the listing code when it has one, otherwise a short id. */
export function propertyLabel(id: string, found: DeletionCandidate[]) {
  return found.find((property) => String(property.id) === id)?.property_code ?? id.slice(0, 8);
}
