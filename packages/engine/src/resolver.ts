import { getCardDef, type MatchContext } from './context.js';
import { EngineError } from './errors.js';
import { computePowers, type PowerMap } from './power.js';
import { isOnBoard, staticTargets, terrainAt, type Source } from './query.js';
import { Rng } from './rng.js';
import type {
  CardDef,
  CardFilter,
  CardInstance,
  CardZone,
  MatchEvent,
  MatchState,
  MoveDestination,
  PlayerIndex,
  Side,
  TargetSelector,
} from './types.js';

/**
 * Porte l'état mutable pendant une étape de résolution (clone de l'état d'entrée),
 * le RNG et le journal d'événements destiné à l'animation.
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

  // -------------------------------------------------------------------------
  // Création et zones
  // -------------------------------------------------------------------------

  createInstance(defId: string, owner: PlayerIndex, zone: CardZone, token: boolean): CardInstance {
    const def = getCardDef(this.ctx, defId);
    const uid = `k${this.s.nextUid++}`;
    const c: CardInstance = {
      uid,
      defId,
      owner,
      controller: owner,
      zone,
      terrain: null,
      powerBase: def.power,
      powerMod: 0,
      revealed: false,
      playedTurn: null,
      token,
      effectsCancelled: false,
      continuousCancelled: false,
      hidden: false,
      clickbaitUntilTurn: null,
    };
    this.s.cards[uid] = c;
    return c;
  }

  hasRoom(terrain: number, player: PlayerIndex): boolean {
    return terrainAt(this.s, terrain).slots[player].length < this.ctx.rules.maxCardsPerTerrain;
  }

  /** Terrains où un joueur peut recevoir une carte (place libre, terrain jouable). */
  openTerrains(player: PlayerIndex, exclude: number | null): number[] {
    const out: number[] = [];
    this.s.terrains.forEach((t, i) => {
      if (i === exclude) return;
      if (!t.revealed && !this.ctx.rules.allowPlayOnUnrevealedTerrain) return;
      if (this.hasRoom(i, player)) out.push(i);
    });
    return out;
  }

  placeOnBoard(c: CardInstance, terrain: number, player: PlayerIndex): void {
    terrainAt(this.s, terrain).slots[player].push(c.uid);
    c.zone = 'board';
    c.terrain = terrain;
    c.controller = player;
  }

  removeFromBoard(c: CardInstance): void {
    if (c.terrain === null) return;
    const slots = terrainAt(this.s, c.terrain).slots[c.controller];
    const i = slots.indexOf(c.uid);
    if (i >= 0) slots.splice(i, 1);
    c.terrain = null;
  }

  removeFromHand(c: CardInstance): void {
    const hand = this.s.players[c.controller].hand;
    const i = hand.indexOf(c.uid);
    if (i >= 0) hand.splice(i, 1);
  }

  draw(player: PlayerIndex): void {
    const p = this.s.players[player];
    if (p.deck.length === 0) {
      this.emit({ type: 'draw_failed', player, reason: 'deck_empty' });
      return;
    }
    if (p.hand.length >= this.ctx.rules.maxHandSize) {
      this.emit({ type: 'draw_failed', player, reason: 'hand_full' });
      return;
    }
    const uid = p.deck.shift() as string;
    p.hand.push(uid);
    this.card(uid).zone = 'hand';
    this.emit({ type: 'card_drawn', player, uid });
  }

  // -------------------------------------------------------------------------
  // Ciblage
  // -------------------------------------------------------------------------

  selectTargets(src: Source, selector: TargetSelector, filter: CardFilter | undefined, side: Side | undefined): string[] {
    const pool = staticTargets(this.ctx, this.s, src, selector, filter, side);
    switch (selector) {
      case 'random_enemy_here':
        return pool.length ? [this.rng.pick(pool).uid] : [];
      case 'strongest_enemy_here':
        return this.extreme(pool, 'max');
      case 'weakest_enemy_here':
        return this.extreme(pool, 'min');
      default:
        return pool.map((c) => c.uid);
    }
  }

  /** Carte la plus forte / faible ; égalité → la première posée. */
  extreme(pool: CardInstance[], mode: 'max' | 'min'): string[] {
    if (pool.length === 0) return [];
    const powers = this.powers();
    let best = pool[0] as CardInstance;
    for (const c of pool) {
      const pc = powers[c.uid] ?? 0;
      const pb = powers[best.uid] ?? 0;
      if (mode === 'max' ? pc > pb : pc < pb) best = c;
    }
    return [best.uid];
  }

  // -------------------------------------------------------------------------
  // Opérations
  // -------------------------------------------------------------------------

  addPower(uid: string, delta: number, source: string | null): void {
    if (delta === 0) return;
    this.card(uid).powerMod += delta;
    this.emit({ type: 'power_changed', uid, delta, source });
  }

  setPower(uid: string, value: number, source: string | null): void {
    const c = this.card(uid);
    c.powerBase = value;
    c.powerMod = 0;
    this.emit({ type: 'power_set', uid, value, source });
  }

  destroy(uid: string, source: string | null): void {
    const c = this.card(uid);
    if (!isOnBoard(c)) return;
    this.removeFromBoard(c);
    c.zone = 'destroyed';
    this.s.players[c.owner].destroyed.push(uid);
    this.emit({ type: 'card_destroyed', uid, source });
  }

  move(uid: string, to: MoveDestination, source: string | null): void {
    const c = this.card(uid);
    if (!isOnBoard(c)) return;
    const from = c.terrain as number;
    const open = this.openTerrains(c.controller, from);
    let dest: number | undefined;
    if (to === 'random_other') dest = open.length ? this.rng.pick(open) : undefined;
    else {
      const wanted = to === 'left' ? from - 1 : from + 1;
      dest = open.includes(wanted) ? wanted : undefined;
    }
    if (dest === undefined) return;
    this.removeFromBoard(c);
    this.placeOnBoard(c, dest, c.controller);
    this.emit({ type: 'card_moved', uid, from, to: dest, source });
  }

  steal(uid: string, to: PlayerIndex, source: string | null): void {
    const c = this.card(uid);
    if (!isOnBoard(c) || c.controller === to) return;
    const terrain = c.terrain as number;
    if (!this.hasRoom(terrain, to)) return;
    const from = c.controller;
    this.removeFromBoard(c);
    this.placeOnBoard(c, terrain, to);
    this.emit({ type: 'card_stolen', uid, from, to, terrain, source });
  }

  /** Copie (jeton) d'une carte, révélée immédiatement, sans effet « à la révélation ». */
  copy(
    uid: string,
    player: PlayerIndex,
    to: 'here' | 'random_other' | 'hand',
    here: number | null,
    powerDelta: number,
    source: string | null,
  ): CardInstance | null {
    const original = this.card(uid);
    let dest: number | null = null;
    if (to === 'hand') {
      if (this.s.players[player].hand.length >= this.ctx.rules.maxHandSize) return null;
    } else if (to === 'here') {
      if (here === null || !this.hasRoom(here, player)) return null;
      dest = here;
    } else {
      const open = this.openTerrains(player, here);
      if (open.length === 0) return null;
      dest = this.rng.pick(open);
    }

    const c = this.createInstance(original.defId, player, to === 'hand' ? 'hand' : 'board', true);
    c.powerBase = original.powerBase;
    c.powerMod = original.powerMod + powerDelta;
    if (dest === null) {
      this.s.players[player].hand.push(c.uid);
    } else {
      this.placeOnBoard(c, dest, player);
      c.revealed = true;
      c.playedTurn = this.s.turn;
    }
    this.emit({
      type: 'card_created',
      uid: c.uid,
      defId: c.defId,
      player,
      zone: dest === null ? 'hand' : 'board',
      terrain: dest,
      source,
    });
    return c;
  }

  transform(uid: string, into: readonly string[], source: string | null): void {
    if (into.length === 0) return;
    const c = this.card(uid);
    const target = into.length === 1 ? (into[0] as string) : this.rng.pick(into);
    const from = c.defId;
    c.defId = target;
    c.powerBase = getCardDef(this.ctx, target).power;
    c.powerMod = 0;
    c.effectsCancelled = false;
    c.continuousCancelled = false;
    this.emit({ type: 'card_transformed', uid, from, to: target, source });
  }

  discard(player: PlayerIndex, pick: 'random' | 'highest_cost' | 'lowest_cost', source: string | null): void {
    const p = this.s.players[player];
    if (p.hand.length === 0) return;
    let uid: string;
    if (pick === 'random') uid = this.rng.pick(p.hand);
    else {
      const cost = (id: string) => getCardDef(this.ctx, this.card(id).defId).cost;
      uid = p.hand[0] as string;
      for (const id of p.hand) {
        if (pick === 'highest_cost' ? cost(id) > cost(uid) : cost(id) < cost(uid)) uid = id;
      }
    }
    p.hand.splice(p.hand.indexOf(uid), 1);
    p.discarded.push(uid);
    this.card(uid).zone = 'discarded';
    this.emit({ type: 'card_discarded', uid, player, source });
  }

  addToHand(player: PlayerIndex, defId: string, source: string | null): void {
    if (this.s.players[player].hand.length >= this.ctx.rules.maxHandSize) return;
    const c = this.createInstance(defId, player, 'hand', true);
    this.s.players[player].hand.push(c.uid);
    this.emit({ type: 'card_created', uid: c.uid, defId, player, zone: 'hand', terrain: null, source });
  }

  hide(uid: string, source: string | null): void {
    const c = this.card(uid);
    if (c.hidden) return;
    c.hidden = true;
    this.emit({ type: 'card_hidden', uid, source });
  }

  cancelEffects(uid: string, scope: 'all' | 'continuous', source: string | null): void {
    const c = this.card(uid);
    if (scope === 'all') c.effectsCancelled = true;
    else c.continuousCancelled = true;
    this.emit({ type: 'effects_cancelled', uid, scope, source });
  }
}
