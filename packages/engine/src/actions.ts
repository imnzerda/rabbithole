import { evalAmount, evalCondition, sidePlayer, sourceOf, terrainHasModifier, type Source } from './query.js';
import type { Resolver } from './resolver.js';
import type { Action, CardInstance, Effect } from './types.js';

/** Effet « aléatoire » au sens du terrain Las Vegas (déclenché deux fois). */
export function isRandomAction(action: Action): boolean {
  return action.type === 'random_of' || ('target' in action && action.target === 'random_enemy_here');
}

export function executeAction(r: Resolver, src: Source, action: Action, depth = 0): void {
  const { ctx, s } = r;
  switch (action.type) {
    case 'add_power': {
      const amount = evalAmount(ctx, s, src, action.amount);
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) r.addPower(uid, amount, src.uid);
      return;
    }
    case 'set_power': {
      const value = evalAmount(ctx, s, src, action.amount);
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) r.setPower(uid, value, src.uid);
      return;
    }
    case 'destroy':
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) r.destroy(uid, src.uid);
      return;
    case 'move':
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) r.move(uid, action.to, src.uid);
      return;
    case 'copy':
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) {
        r.copy(uid, src.controller, action.to ?? 'here', src.terrain, action.powerDelta ?? 0, src.uid);
      }
      return;
    case 'transform':
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) {
        r.transform(uid, action.into, src.uid);
      }
      return;
    case 'steal':
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) {
        r.steal(uid, src.controller, src.uid);
      }
      return;
    case 'hide':
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) r.hide(uid, src.uid);
      return;
    case 'cancel_effects':
      for (const uid of r.selectTargets(src, action.target, action.filter, action.side)) {
        r.cancelEffects(uid, action.scope ?? 'all', src.uid);
      }
      return;
    case 'draw': {
      const p = sidePlayer(src.controller, action.side);
      for (let i = 0; i < action.amount; i++) r.draw(p);
      return;
    }
    case 'discard': {
      const p = sidePlayer(src.controller, action.side);
      for (let i = 0; i < action.amount; i++) r.discard(p, action.pick ?? 'random', src.uid);
      return;
    }
    case 'add_card_to_hand': {
      const p = sidePlayer(src.controller, action.side);
      if (action.pick === 'random') {
        for (let i = 0; i < (action.count ?? 1); i++) r.addToHand(p, r.rng.pick(action.cards), src.uid);
      } else {
        for (const id of action.cards) r.addToHand(p, id, src.uid);
      }
      return;
    }
    case 'random_of': {
      if (depth >= ctx.rules.maxEffectDepth || action.options.length === 0) return;
      const index = r.rng.weighted(action.weights ?? action.options.map(() => 1));
      r.emit({ type: 'random_choice', source: src.uid, index, of: action.options.length });
      executeAction(r, src, action.options[index] as Action, depth + 1);
      return;
    }
    default:
      action satisfies never;
  }
}

/** Exécute un effet de carte (condition, puis action ; deux fois si aléatoire sur Las Vegas). */
export function runEffect(r: Resolver, card: CardInstance, effect: Effect): void {
  const src = sourceOf(card);
  if (effect.condition && !evalCondition(r.ctx, r.s, src, effect.condition)) return;
  const times = isRandomAction(effect.action) && terrainHasModifier(r.ctx, r.s, src.terrain, 'random_twice') ? 2 : 1;
  for (let i = 0; i < times; i++) {
    if (card.effectsCancelled) return;
    executeAction(r, sourceOf(card), effect.action);
  }
}
