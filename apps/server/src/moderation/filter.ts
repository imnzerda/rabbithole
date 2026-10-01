import type { CardDef } from '@rabbithole/engine';
import type { User } from '../auth/accounts.js';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { Db } from '../db/db.js';

/**
 * Filtrage du contenu (sections 9 et 14).
 * - **Bloqué** (règles du pays du joueur) : absent des boosters, interdit en deck, caché dans la collection,
 *   affiché en design neutre s'il apparaît chez un adversaire d'un autre pays.
 * - **Masqué** : bloqué + contenu sensible si le joueur a coupé l'interrupteur. Affichage seulement.
 */

export interface CountryRule {
  country: string;
  allowAdult: boolean;
  allowPolitical: boolean;
  blockedCardIds: string[];
}

export async function countryRule(db: Db, country: string): Promise<CountryRule | null> {
  const [row] = await db.query<{ country: string; allow_adult: boolean; allow_political: boolean; blocked_card_ids: string[] }>(
    'SELECT * FROM country_rules WHERE country = $1',
    [country],
  );
  return row ? { country: row.country, allowAdult: row.allow_adult, allowPolitical: row.allow_political, blockedCardIds: row.blocked_card_ids } : null;
}

export function isBlocked(def: CardDef, rule: CountryRule | null): boolean {
  if (!rule) return false;
  if (def.flags?.adult && !rule.allowAdult) return true;
  if (def.flags?.politicallySensitive && !rule.allowPolitical) return true;
  return rule.blockedCardIds.includes(def.id);
}

export const isSensitive = (def: CardDef) => !!(def.flags?.sensitive || def.flags?.adult);

export interface ContentFilter {
  blocked: Set<string>;
  masked: Set<string>;
}

export async function contentFilterFor(db: Db, user: Pick<User, 'country' | 'showSensitive'> | null, catalog: CatalogSnapshot): Promise<ContentFilter> {
  const rule = user ? await countryRule(db, user.country) : null;
  const blocked = new Set<string>();
  const masked = new Set<string>();
  for (const def of Object.values(catalog.ctx.cards)) {
    const b = isBlocked(def, rule);
    if (b) blocked.add(def.id);
    // Sans compte, le contenu sensible est masqué (réglage par défaut).
    if (b || (isSensitive(def) && !(user?.showSensitive ?? false))) masked.add(def.id);
  }
  return { blocked, masked };
}

/** Le catalogue tel qu'un joueur peut l'obtenir : sans les cartes bloquées dans son pays (boosters, crafting). */
export async function catalogForUser(db: Db, user: Pick<User, 'country'>, catalog: CatalogSnapshot): Promise<CatalogSnapshot> {
  const rule = await countryRule(db, user.country);
  if (!rule) return catalog;
  return {
    ...catalog,
    leaders: catalog.leaders.filter((c) => !isBlocked(c, rule)),
    collectibles: catalog.collectibles.filter((c) => !isBlocked(c, rule)),
  };
}
