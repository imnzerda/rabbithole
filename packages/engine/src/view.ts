import { getCardDef, type MatchContext } from './context.js';
import { legalActions, pendingDecision, type Decision, type LegalActions } from './match.js';
import { computePowers } from './power.js';
import { boardOf, isTrending } from './query.js';
import { other, type CardInstance, type CardType, type MatchEvent, type MatchResult, type MatchState, type PlayerIndex } from './types.js';

export interface VisibleCard {
  uid: string;
  defId: string;
  type: CardType;
  /** Puissance effective (en jeu) ou imprimée + modifications (en main). */
  power: number;
  cost: number;
  counter: number;
  rested: boolean;
  buzz: number;
  cancelled: boolean;
  trending: boolean;
  /** Posée ce tour (ne peut pas attaquer, sauf Élan). */
  fresh: boolean;
}

export interface SideView {
  leader: VisibleCard;
  characters: VisibleCard[];
  life: number;
  handCount: number;
  deckCount: number;
  trashCount: number;
  /** Dernière carte de la défausse (publique). */
  trashTop: string | null;
  buzzActive: number;
  buzzRested: number;
  /** Buzz encore dans la réserve. */
  buzzDeck: number;
  hypeDeclared: boolean;
}

export interface BattleView {
  attacker: string;
  target: string;
  declaredTarget: string;
  attackerPower: number;
  defenderPower: number;
  blocked: boolean;
}

export interface PlayerView {
  you: PlayerIndex;
  turn: number;
  active: PlayerIndex;
  first: PlayerIndex;
  phase: MatchState['phase'];
  decision: Decision | null;
  me: SideView & { hand: VisibleCard[] };
  opponent: SideView;
  battle: BattleView | null;
  /** Carte Vie révélée en attente de décision Déclencheur (publique). */
  revealedTrigger: { player: PlayerIndex; defId: string } | null;
  stake: number;
  /** Actions possibles, seulement quand c'est à ce joueur de décider. */
  legal: LegalActions | null;
  result: MatchResult | null;
}

/**
 * Ce qu'un joueur a le droit de voir : jamais la main, la pioche ni les Vies
 * de l'adversaire. Le serveur n'envoie que cette vue au client.
 */
export function getPlayerView(ctx: MatchContext, s: MatchState, viewer: PlayerIndex): PlayerView {
  const powers = computePowers(ctx, s);
  const visible = (c: CardInstance): VisibleCard => {
    const def = getCardDef(ctx, c.defId);
    return {
      uid: c.uid,
      defId: c.defId,
      type: def.type,
      power: powers[c.uid] ?? def.power + c.permMod,
      cost: def.cost,
      counter: def.counter ?? 0,
      rested: c.rested,
      buzz: c.buzz,
      cancelled: c.effectsCancelled,
      trending: isTrending(s, c),
      fresh: c.playedTurn === s.turn,
    };
  };
  const side = (p: PlayerIndex): SideView => {
    const ps = s.players[p];
    const [leader, ...characters] = boardOf(s, p);
    return {
      leader: visible(leader!),
      characters: characters.map(visible),
      life: ps.life.length,
      handCount: ps.hand.length,
      deckCount: ps.deck.length,
      trashCount: ps.trash.length,
      trashTop: ps.trash.length ? s.cards[ps.trash[ps.trash.length - 1]!]!.defId : null,
      buzzActive: ps.buzzActive,
      buzzRested: ps.buzzRested,
      buzzDeck: ps.buzzDeck,
      hypeDeclared: ps.hypeDeclared,
    };
  };
  const b = s.battle;
  const trigger = s.damage?.trigger ? s.cards[s.damage.trigger] : undefined;
  return {
    you: viewer,
    turn: s.turn,
    active: s.active,
    first: s.first,
    phase: s.phase,
    decision: pendingDecision(s),
    me: { ...side(viewer), hand: s.players[viewer].hand.map((uid) => visible(s.cards[uid]!)) },
    opponent: side(other(viewer)),
    battle: b
      ? {
          attacker: b.attacker,
          target: b.target,
          declaredTarget: b.declaredTarget,
          attackerPower: powers[b.attacker] ?? 0,
          defenderPower: powers[b.target] ?? 0,
          blocked: b.blocked,
        }
      : null,
    revealedTrigger: trigger && s.damage ? { player: s.damage.player, defId: trigger.defId } : null,
    stake: s.stake,
    legal: legalActions(ctx, s, viewer),
    result: s.result,
  };
}

/** Identifiant de remplacement pour une carte que le joueur n'a pas le droit d'identifier. */
export const HIDDEN_UID = 'hidden';

/**
 * Événements qu'un joueur a le droit de recevoir. On masque ce qui révélerait
 * les cartes cachées de l'adversaire : sa pioche, les Vies qui rejoignent sa main
 * et les cartes générées directement dans sa main.
 */
export function eventsFor(events: readonly MatchEvent[], viewer: PlayerIndex): MatchEvent[] {
  return events.map((e) => {
    switch (e.type) {
      case 'card_drawn':
        return e.player === viewer ? e : { ...e, uid: HIDDEN_UID };
      case 'life_lost':
        return e.player === viewer || e.to === 'trash' ? e : { ...e, uid: HIDDEN_UID };
      case 'card_created':
        return e.player === viewer ? e : { ...e, uid: HIDDEN_UID, defId: HIDDEN_UID };
      default:
        return e;
    }
  });
}
