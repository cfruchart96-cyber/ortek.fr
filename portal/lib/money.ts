export function euros(cents: number) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100); }
export function commissionAmount(amountCents: number, rule: { fixed_cents: number; percentage_bps: number; performance_bonus_cents?: number }) {
  return rule.fixed_cents + Math.round(amountCents * rule.percentage_bps / 10000) + (rule.performance_bonus_cents ?? 0);
}
