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

/** Doublons donnés pour un trade-up : les plus nombreux d'abord ; null s'il n'y en a pas assez. */
export function pickSpares(spares: readonly Spare[], required: number): { cardId: string; count: number }[] | null {
  const out: { cardId: string; count: number }[] = [];
  let left = required;
  for (const s of spares) {
    if (left === 0) break;
    const n = Math.min(s.spare, left);
    out.push({ cardId: s.cardId, count: n });
    left -= n;
  }
  return left === 0 ? out : null;
}
