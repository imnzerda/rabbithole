import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export type PhoneError = 'invalid_phone' | 'virtual_phone' | 'phone_country';

/**
 * Normalise un numéro (format international E.164) et refuse ce qui ne peut pas recevoir
 * un code de façon fiable ou sert à la fraude : numéros virtuels (VoIP), surtaxés, fixes,
 * et pays hors liste (fraude aux SMS surtaxés).
 */
export function normalizePhone(raw: string, defaultCountry: string, allowedCountries: string[]): { e164: string } | { error: PhoneError } {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid()) return { error: 'invalid_phone' };
  const type = parsed.getType();
  if (type === 'VOIP' || type === 'PERSONAL_NUMBER' || type === 'UAN' || type === 'PAGER') return { error: 'virtual_phone' };
  // Les numéros américains sont « fixe ou mobile » : impossible de trancher, on les accepte.
  if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return { error: 'invalid_phone' };
  if (!parsed.country || !allowedCountries.includes(parsed.country)) return { error: 'phone_country' };
  return { e164: parsed.number };
}

/** Numéro masqué pour l'affichage : `+33 6 •• •• •• 78`. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} ${'•'.repeat(Math.max(0, e164.length - 6))} ${e164.slice(-2)}`;
}
