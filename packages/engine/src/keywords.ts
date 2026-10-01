import { executeAction, runEffect } from './actions.js';
import { isOnBoard, sourceOf, staticTargets, terrainHasModifier } from './query.js';
import type { Resolver } from './resolver.js';
import { other, type CardDef, type CardInstance, type Trigger } from './types.js';

const isActive = (c: CardInstance) => isOnBoard(c) && !c.effectsCancelled;

/** La carte a encore quelque chose que `Cancel` peut lui faire perdre une fois en jeu. */
export function hasLingeringEffects(def: CardDef): boolean {
  return def.keywords.includes('croissance') || def.effects.some((e) => e.trigger !== 'on_reveal');
}

/**
 * Révélation d'une carte. Ordre fixe :
 * Élan → Clickbait → Cancel → Rickroll → Séduction → Ratio → Shitpost → effets « à la révélation » → Viral
 * (Viral en dernier pour que la copie hérite des bonus de la révélation).
 */
export function revealCard(r: Resolver, c: CardInstance): void {
  const { ctx, s } = r;
  const kw = ctx.rules.keywords;
  c.revealed = true;
  r.emit({ type: 'card_revealed', player: c.controller, uid: c.uid, defId: c.defId, terrain: c.terrain as number });
  if (c.effectsCancelled) return;

  const def = r.defOf(c);
  const has = (k: CardDef['keywords'][number]) => def.keywords.includes(k);
  const trigger = (keyword: CardDef['keywords'][number], targets: string[]) =>
    r.emit({ type: 'keyword_triggered', uid: c.uid, keyword, targets });

  // Élan : +2 si jouée aux tours 1 à 3 (à tous les tours sur Stade).
  if (has('elan') && (s.turn <= kw.elan.maxTurn || terrainHasModifier(ctx, s, c.terrain, 'elan_always'))) {
    trigger('elan', [c.uid]);
    r.addPower(c.uid, kw.elan.bonus, c.uid);
  }

  // Clickbait : +4 jusqu'à la fin du tour suivant (bonus réel, calculé dans computePowers).
  if (has('clickbait')) {
    c.clickbaitUntilTurn = s.turn + kw.clickbait.durationTurns;
    trigger('clickbait', [c.uid]);
  }

  // Cancel : la carte adverse la plus forte ici qui a encore un effet le perd.
  if (has('cancel') && isActive(c)) {
    const pool = staticTargets(ctx, s, sourceOf(c), 'enemies_here', undefined, undefined).filter(
      (e) => !e.effectsCancelled && hasLingeringEffects(r.defOf(e)),
    );
    const [target] = r.extreme(pool, 'max');
    if (target) {
      trigger('cancel', [target]);
      r.cancelEffects(target, 'all', c.uid);
    }
  }

  // Rickroll : la carte adverse la plus forte ici part sur un autre terrain.
  if (has('rickroll') && isActive(c)) {
    const [target] = r.selectTargets(sourceOf(c), 'strongest_enemy_here', undefined, undefined);
    if (target) {
      const before = r.card(target).terrain;
      r.move(target, 'random_other', c.uid);
      if (r.card(target).terrain !== before) trigger('rickroll', [target]);
    }
  }

  // Séduction : la carte adverse la plus faible ici passe dans mon camp.
  if (has('seduction') && isActive(c)) {
    const [target] = r.selectTargets(sourceOf(c), 'weakest_enemy_here', undefined, undefined);
    if (target && r.hasRoom(c.terrain as number, c.controller)) {
      trigger('seduction', [target]);
      r.steal(target, c.controller, c.uid);
    }
  }

  // Ratio : la carte adverse la plus forte ici perd 3.
  if (has('ratio') && isActive(c)) {
    const [target] = r.selectTargets(sourceOf(c), 'strongest_enemy_here', undefined, undefined);
    if (target) {
      trigger('ratio', [target]);
      r.addPower(target, -kw.ratio.amount, c.uid);
    }
  }

  // Shitpost : un résultat au hasard dans la table (deux fois à Las Vegas).
  if (has('shitpost') && isActive(c)) {
    const times = terrainHasModifier(ctx, s, c.terrain, 'random_twice') ? 2 : 1;
    for (let i = 0; i < times && isActive(c); i++) {
      const table = kw.shitpost.table;
      const index = r.rng.weighted(table.map((e) => e.weight));
      trigger('shitpost', []);
      r.emit({ type: 'random_choice', source: c.uid, index, of: table.length });
      executeAction(r, sourceOf(c), table[index]!.action);
    }
  }

  for (const eff of def.effects) {
    if (eff.trigger !== 'on_reveal') continue;
    if (!isActive(c)) break;
    runEffect(r, c, eff);
  }

  // Viral : une copie (-1) sur un autre terrain.
  if (has('viral') && isActive(c)) {
    const copy = r.copy(c.uid, c.controller, 'random_other', c.terrain, -kw.viral.powerPenalty, c.uid);
    if (copy) trigger('viral', [copy.uid]);
  }
}

/** Cartes révélées en jeu, dans un ordre déterministe : joueur `first`, puis terrains, puis ordre de pose. */
export function boardOrder(r: Resolver, first: CardInstance['controller']): CardInstance[] {
  const out: CardInstance[] = [];
  for (const p of [first, other(first)]) {
    for (const t of r.s.terrains) {
      for (const uid of t.slots[p]) {
        const c = r.card(uid);
        if (c.revealed) out.push(c);
      }
    }
  }
  return out;
}

/** Déclencheurs de tour : Croissance (fin de tour), effets DSL `start_of_turn` / `end_of_turn` / `end_of_game`. */
export function runTriggers(r: Resolver, trigger: Exclude<Trigger, 'on_reveal' | 'continuous'>): void {
  const { s, ctx } = r;
  for (const c of boardOrder(r, s.revealFirst)) {
    if (!isActive(c)) continue;
    const continuousOk = !c.continuousCancelled;
    const def = r.defOf(c);

    if (trigger === 'end_of_turn' && continuousOk && def.keywords.includes('croissance')) {
      r.emit({ type: 'keyword_triggered', uid: c.uid, keyword: 'croissance', targets: [c.uid] });
      r.addPower(c.uid, ctx.rules.keywords.croissance.perTurn, c.uid);
    }

    if (trigger !== 'end_of_game' && !continuousOk) continue;
    for (const eff of def.effects) {
      if (eff.trigger !== trigger) continue;
      if (!isActive(c)) break;
      runEffect(r, c, eff);
    }
  }
}
