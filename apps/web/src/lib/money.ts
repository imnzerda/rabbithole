/** Prix en unité mineure (centimes ; le yen n'en a pas) → texte localisé, ex. « 4,99 € ». */
export function formatPrice(amount: number, currency: string, locale: string): string {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}

/** Saisie en unités (ex. « 20 » euros) → unité mineure de la devise. */
export function toMinor(value: number, currency: string): number {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return Math.round(value * 10 ** digits);
}

export function fromMinor(amount: number, currency: string): number {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return amount / 10 ** digits;
}
