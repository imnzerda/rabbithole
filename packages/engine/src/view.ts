import { getCardDef, type MatchContext } from './context.js';
import { computePowers } from './power.js';
import { isTrending, manaForTurn, playCost } from './query.js';
import { other, type CardInstance, type MatchResult, type MatchState, type PlayerIndex } from './types.js';

export interface VisibleCard {
  uid: string;
  /** `null` = face cachée (non révélée ou cachée par un effet). */
  defId: string | null;
  /** Puissance affichée. `null` si inconnue. */
  power: number | null;
  /** Coût de base, uniquement pour les cartes en main. */
  cost?: number;
  owner: PlayerIndex;
  hidden: boolean;
  clickbait: boolean;
  trending: boolean;
}

export interface TerrainView {
  /** `null` tant que le terrain n'est pas révélé. */
  defId: string | null;
  revealed: boolean;
  cards: [VisibleCard[], VisibleCard[]];
  /** Puissance visible par le joueur (hors cartes cachées adverses). */
  power: [number, number];
}

export interface PlayerView {
  you: PlayerIndex;
  turn: number;
  phase: MatchState['phase'];
  mana: number;
  stake: number;
  hypeDeclared: [boolean, boolean];
  revealFirst: PlayerIndex;
  revealFirstReason: MatchState['revealFirstReason'];
  hand: VisibleCard[];
  deckCount: number;
  opponentHandCount: number;
  opponentDeckCount: number;
  terrains: TerrainView[];
  result: MatchResult | null;
}

/**
 * Ce qu'un joueur a le droit de voir : jamais la main, la pioche ni les cartes
 * face cachée de l'adversaire. Le serveur n'envoie que cette vue au client.
 */
export function getPlayerView(ctx: MatchContext, s: MatchState, viewer: PlayerIndex): PlayerView {
  const powers = computePowers(ctx, s);

  const visible = (c: CardInstance): VisibleCard => {
    const mine = c.controller === viewer;
    const faceDown = !c.revealed || (c.hidden && !mine);
    const real = powers[c.uid] ?? null;
    return {
      uid: c.uid,
      defId: faceDown ? null : c.defId,
      power: faceDown ? null : real,
      owner: c.owner,
      hidden: c.hidden,
      clickbait: !faceDown && c.clickbaitUntilTurn !== null,
      trending: !faceDown && isTrending(s, c),
    };
  };

  const terrains: TerrainView[] = s.terrains.map((t) => {
    const cards = t.slots.map((uids) => uids.map((uid) => visible(s.cards[uid]!))) as [VisibleCard[], VisibleCard[]];
    const sum = (list: VisibleCard[]) => list.reduce((acc, c) => acc + (c.power ?? 0), 0);
    return {
      defId: t.revealed ? t.defId : null,
      revealed: t.revealed,
      cards,
      power: [sum(cards[0]), sum(cards[1])],
    };
  });

  const me = s.players[viewer];
  const opp = s.players[other(viewer)];
  return {
    you: viewer,
    turn: s.turn,
    phase: s.phase,
    mana: manaForTurn(ctx, s.turn),
    stake: s.stake,
    hypeDeclared: [s.players[0].hypeDeclared, s.players[1].hypeDeclared],
    revealFirst: s.revealFirst,
    revealFirstReason: s.revealFirstReason,
    hand: me.hand.map((uid) => {
      const c = s.cards[uid]!;
      return {
        uid,
        defId: c.defId,
        power: c.powerBase + c.powerMod,
        cost: getCardDef(ctx, c.defId).cost,
        owner: c.owner,
        hidden: false,
        clickbait: false,
        trending: isTrending(s, c),
      };
    }),
    deckCount: me.deck.length,
    opponentHandCount: opp.hand.length,
    opponentDeckCount: opp.deck.length,
    terrains,
    result: s.result,
  };
}

/** Coût de chaque carte de la main sur chaque terrain (aide à l'UI pour les réductions de terrain). */
export function handCosts(ctx: MatchContext, s: MatchState, player: PlayerIndex): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const uid of s.players[player].hand) {
    out[uid] = s.terrains.map((_, i) => playCost(ctx, s, s.cards[uid]!, i));
  }
  return out;
}
