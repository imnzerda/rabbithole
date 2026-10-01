import { getCardDef, type MatchContext } from './context.js';
import { EngineError } from './errors.js';
import { computePowers, type PowerMap } from './power.js';
import { candidateTargets, type Source } from './query.js';
import { Rng } from './rng.js';
import type {
  CardDef,
  CardFilter,
  CardInstance,
  CardZone,
  Duration,
  MatchEvent,
  MatchState,
  PlayerIndex,
  TargetSelector,
} from './types.js';

/**
 * Porte l'état mutable pendant une étape (clone de l'état d'entrée), le RNG
 * et le journal d'événements destiné à l'animation.
 */
export class Resolver {
  readonly rng: Rng;
  readonly events: MatchEvent[] = [];

  constructor(
    readonly ctx: MatchContext,
    readonly s: MatchState,
  ) {
    this.rng = Rng.fromState(s.rng);
  }

  commit(): void {
    this.s.rng = this.rng.getState();
  }

  emit(e: MatchEvent): void {
    this.events.push(e);
  }

  card(uid: string): CardInstance {
    const c = this.s.cards[uid];
    if (!c) throw new EngineError('unknown_card', `Instance inconnue : ${uid}`);
    return c;
  }

  defOf(c: CardInstance): CardDef {
    return getCardDef(this.ctx, c.defId);
  }

  powers(): PowerMap {
    return computePowers(this.ctx, this.s);
  }

  power(uid: string): number {
    return this.powers()[uid] ?? 0;
  }

  // -------------------------------------------------------------------------
  // Zones
  // -------------------------------------------------------------------------

  createInstance(defId: string, owner: PlayerIndex, zone: CardZone, token: boolean): CardInstance {
    getCardDef(this.ctx, defId);
    const uid = `k${this.s.nextUid++}`;
    const c: CardInstance = {
      uid,
      defId,
      owner,
      controller: owner,
      zone,
      rested: false,
      playedTurn: null,
      buzz: 0,
      permMod: 0,
      turnMod: 0,
      battleMod: 0,
      effectsCancelled: false,
      activatedTurn: null,
      token,
    };
    this.s.cards[uid] = c;
    return c;
  }

  /** Retire une carte de la liste de sa zone actuelle. */
  private detach(c: CardInstance): void {
    const p = this.s.players[c.controller];
    const lists: Partial<Record<CardZone, string[]>> = {
      deck: p.deck,
      hand: p.hand,
      life: p.life,
      field: p.characters,
      trash: p.trash,
    };
    const list = lists[c.zone];
    if (list) {
      const i = list.indexOf(c.uid);
      if (i >= 0) list.splice(i, 1);
    }
    if (c.zone === 'field' && c.buzz > 0) {
      // Les Buzz attachés retournent, épuisés, dans la zone de coût du contrôleur.
      p.buzzRested += c.buzz;
      c.buzz = 0;
    }
  }

  /** Remet à zéro l'état d'une carte qui quitte le terrain. */
  private resetCard(c: CardInstance): void {
    c.rested = false;
    c.permMod = 0;
    c.turnMod = 0;
    c.battleMod = 0;
    c.effectsCancelled = false;
    c.activatedTurn = null;
  }

  moveTo(c: CardInstance, zone: Exclude<CardZone, 'leader'>, player: PlayerIndex = c.owner, top = false): void {
    this.detach(c);
    if (zone !== 'field') this.resetCard(c);
    c.zone = zone;
    c.controller = player;
    const p = this.s.players[player];
    const list = { deck: p.deck, hand: p.hand, life: p.life, field: p.characters, trash: p.trash }[zone];
    if (top) list.unshift(c.uid);
    else list.push(c.uid);
  }

  /** Pioche une carte. Renvoie `false` si la pioche est vide. */
  draw(player: PlayerIndex): boolean {
    const p = this.s.players[player];
    const uid = p.deck[0];
    if (!uid) {
      this.emit({ type: 'draw_failed', player });
      return false;
    }
    this.moveTo(this.card(uid), 'hand', player);
    this.emit({ type: 'card_drawn', player, uid });
    return true;
  }

  gainBuzz(player: PlayerIndex, amount: number, rested: boolean): void {
    const p = this.s.players[player];
    const n = Math.min(amount, p.buzzDeck);
    if (n <= 0) return;
    p.buzzDeck -= n;
    if (rested) p.buzzRested += n;
    else p.buzzActive += n;
    this.emit({ type: 'buzz_gained', player, amount: n, rested });
  }

  // -------------------------------------------------------------------------
  // Ciblage
  // -------------------------------------------------------------------------

  /** Résout un sélecteur. Égalité « plus fort / plus faible » → la carte posée en premier. */
  selectTargets(src: Source, selector: TargetSelector, filter: CardFilter | undefined): string[] {
    const pool = candidateTargets(this.ctx, this.s, src, selector, filter);
    if (pool.length === 0) return [];
    switch (selector) {
      case 'random_enemy':
        return [this.rng.pick(pool).uid];
      case 'strongest_enemy':
      case 'strongest_ally':
        return [this.extreme(pool, 'max')];
      case 'weakest_enemy':
      case 'weakest_ally':
        return [this.extreme(pool, 'min')];
      default:
        return pool.map((c) => c.uid);
    }
  }

  extreme(pool: CardInstance[], mode: 'max' | 'min'): string {
    const powers = this.powers();
    let best = pool[0] as CardInstance;
    for (const c of pool) {
      const pc = powers[c.uid] ?? 0;
      const pb = powers[best.uid] ?? 0;
      if (mode === 'max' ? pc > pb : pc < pb) best = c;
    }
    return best.uid;
  }

  // -------------------------------------------------------------------------
  // Opérations de jeu
  // -------------------------------------------------------------------------

  addPower(uid: string, delta: number, duration: Duration, source: string | null): void {
    if (delta === 0) return;
    const c = this.card(uid);
    if (duration === 'permanent') c.permMod += delta;
    else if (duration === 'turn') c.turnMod += delta;
    else c.battleMod += delta;
    this.emit({ type: 'power_changed', uid, delta, duration, power: this.power(uid), source });
  }

  rest(uid: string, source: string | null): void {
    const c = this.card(uid);
    if (c.rested) return;
    c.rested = true;
    this.emit({ type: 'card_rested', uid, source });
  }

  refresh(uid: string, source: string | null): void {
    const c = this.card(uid);
    if (!c.rested) return;
    c.rested = false;
    this.emit({ type: 'card_refreshed', uid, source });
  }

  bounce(uid: string, source: string | null): void {
    const c = this.card(uid);
    if (c.zone !== 'field') return;
    this.moveTo(c, 'hand', c.owner);
    this.emit({ type: 'card_bounced', uid, source });
  }

  steal(uid: string, to: PlayerIndex, source: string | null): void {
    const c = this.card(uid);
    if (c.zone !== 'field' || c.controller === to) return;
    if (this.s.players[to].characters.length >= this.ctx.rules.maxCharacters) return;
    const from = c.controller;
    this.moveTo(c, 'field', to);
    c.playedTurn = this.s.turn;
    this.emit({ type: 'card_stolen', uid, from, to, source });
  }

  cancelEffects(uid: string, source: string | null): void {
    const c = this.card(uid);
    if (c.effectsCancelled) return;
    c.effectsCancelled = true;
    this.emit({ type: 'effects_cancelled', uid, source });
  }

  discard(player: PlayerIndex, pick: 'random' | 'highest_cost' | 'lowest_cost', source: string | null): void {
    const hand = this.s.players[player].hand;
    if (hand.length === 0) return;
    let uid: string;
    if (pick === 'random') uid = this.rng.pick(hand);
    else {
      const cost = (id: string) => this.defOf(this.card(id)).cost;
      uid = hand[0] as string;
      for (const id of hand) if (pick === 'highest_cost' ? cost(id) > cost(uid) : cost(id) < cost(uid)) uid = id;
    }
    this.moveTo(this.card(uid), 'trash');
    this.emit({ type: 'card_discarded', player, uid, source });
  }

  addToHand(player: PlayerIndex, defId: string, source: string | null): void {
    const c = this.createInstance(defId, player, 'hand', true);
    this.s.players[player].hand.push(c.uid);
    this.emit({ type: 'card_created', player, uid: c.uid, defId, source });
  }
}
