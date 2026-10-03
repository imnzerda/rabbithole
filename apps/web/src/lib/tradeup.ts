import type { CardDef, Rarity } from '@rabbithole/engine';

/**
 * Trade-up (section 6.4), côté affichage : doublons disponibles d'une rareté et choix des doublons
 * à donner. Le serveur revérifie tout (rareté, exemplaires gardés) et fait seul le tirage.
 */

export interface Spare {
  cardId: string;
  /** Exemplaires au-delà de ceux qu'on garde pour jouer. */
  spare: number;
}

/** Doublons de cette rareté, les plus nombreux d'abord. */
export function sparesOf(rarity: Rarity, defs: readonly CardDef[], owned: ReadonlyMap<string, number>, keepFor: (def: CardDef) => number): Spare[] {
  return defs
    .filter((d) => d.rarity === rarity)
    .map((d) => ({ cardId: d.id, spare: (owned.get(d.id) ?? 0) - keepFor(d) }))
    .filter((s) => s.spare > 0)
    .sort((a, b) => b.spare - a.spare || a.cardId.localeCompare(b.cardId));
}

/** Un toucher sur un doublon : un exemplaire de plus ; au maximum, le suivant le retire de la sélection. */
export function toggleSpare(picked: ReadonlyMap<string, number>, spare: Spare): Map<string, number> {
  const next = new Map(picked);
  const n = (next.get(spare.cardId) ?? 0) + 1;
  if (n > spare.spare) next.delete(spare.cardId);
  else next.set(spare.cardId, n);
  return next;
}

/** Complète la sélection jusqu'au nombre demandé, avec les doublons les plus nombreux d'abord. */
export function completeSpares(spares: readonly Spare[], picked: ReadonlyMap<string, number>, required: number): Map<string, number> {
  const next = new Map(picked);
  let left = required - [...next.values()].reduce((a, b) => a + b, 0);
  for (const s of spares) {
    if (left <= 0) break;
    const room = s.spare - (next.get(s.cardId) ?? 0);
    const n = Math.min(room, left);
    if (n > 0) {
      next.set(s.cardId, (next.get(s.cardId) ?? 0) + n);
      left -= n;
    }
  }
  return next;
}
