export type CommissionInput = {
  /** Points the referred person just topped up. */
  points: number;
  commissionPercent: number;
  /** Months the commission keeps running from the day the referred person joined. 0 disables it. */
  windowMonths: number;
  /** Smallest top-up that earns anything. 0 counts every top-up. */
  minTopupPoints: number;
  referredAt: string | null;
  now?: Date;
};

/**
 * How many commission points a referrer earns from one top-up, or 0 when the top-up earns nothing.
 *
 * Kept apart from the database work in payReferralCommission so the rules that decide someone's
 * money can be read and tested on their own.
 */
export function commissionForTopup({
  points,
  commissionPercent,
  windowMonths,
  minTopupPoints,
  referredAt,
  now = new Date()
}: CommissionInput) {
  // Blocks the obvious abuse: repeated token top-ups between two numbers to farm commission.
  if (minTopupPoints > 0 && points < minTopupPoints) {
    return 0;
  }

  // The window runs from the day the referred person joined, not from their first top-up, so a
  // dormant referral does not pay forever.
  if (referredAt && windowMonths > 0) {
    const expiresAt = new Date(referredAt);
    expiresAt.setMonth(expiresAt.getMonth() + windowMonths);

    // An unreadable date leaves the window unenforced rather than denying the payment: the marketer
    // should not lose money because a timestamp could not be parsed.
    if (!Number.isNaN(expiresAt.getTime()) && now.getTime() > expiresAt.getTime()) {
      return 0;
    }
  }

  const commission = Math.floor((points * commissionPercent) / 100);

  return commission > 0 ? commission : 0;
}
