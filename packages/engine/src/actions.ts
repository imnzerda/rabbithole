import { evalAmount, evalCondition, sidePlayer, sourceOf, type Source } from './query.js';
import type { Resolver } from './resolver.js';
import type { Action, CardInstance, Effect, Trigger } from './types.js';

export function executeAction(r: Resolver, src: Source, action: Action, depth = 0): void {
  const { ctx, s } = r;
  const targets = () => ('target' in action ? r.selectTargets(src, action.target, action.filter) : []);
  switch (action.type) {
    case 'add_power': {
      const amount = evalAmount(ctx, s, src, action.amount);
      for (const uid of targets()) r.addPower(uid, amount, action.duration ?? 'turn', src.uid);
      return;
    }
    case 'ko':
      for (const uid of targets()) ko(r, uid, src.uid);
      return;
    case 'rest':
      for (const uid of targets()) r.rest(uid, src.uid);
      return;
    case 'refresh':
      for (const uid of targets()) r.refresh(uid, src.uid);
      return;
    case 'bounce':
      for (const uid of targets()) r.bounce(uid, src.uid);
      return;
    case 'steal':
      for (const uid of targets()) r.steal(uid, src.controller, src.uid);
      return;
    case 'cancel_effects':
      for (const uid of targets()) r.cancelEffects(uid, src.uid);
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
    case 'add_buzz':
      r.gainBuzz(src.controller, action.amount, true);
      return;
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

export function runEffect(r: Resolver, card: CardInstance, effect: Effect): void {
  const src = sourceOf(card);
  if (effect.condition && !evalCondition(r.ctx, r.s, src, effect.condition)) return;
  r.emit({ type: 'effect_activated', uid: card.uid, trigger: effect.trigger });
  executeAction(r, src, effect.action);
}

/** Déclenche les effets d'un moment donné (sauf si la carte a perdu ses effets). */
export function runEffects(r: Resolver, card: CardInstance, trigger: Trigger): void {
  if (card.effectsCancelled) return;
  for (const effect of r.defOf(card).effects) {
    if (effect.trigger !== trigger) continue;
    if (r.s.phase === 'ended') return;
    runEffect(r, card, effect);
  }
}

/** Met un Personnage KO : il part dans la défausse de son propriétaire, puis ses effets [KO] s'appliquent. */
export function ko(r: Resolver, uid: string, source: string | null): void {
  const c = r.card(uid);
  if (c.zone !== 'field') return;
  const cancelled = c.effectsCancelled;
  const controller = c.controller;
  r.moveTo(c, 'trash');
  r.emit({ type: 'card_ko', uid, source });
  if (cancelled) return;
  for (const effect of r.defOf(c).effects) {
    if (effect.trigger !== 'on_ko') continue;
    const src = { uid: c.uid, controller };
    if (effect.condition && !evalCondition(r.ctx, r.s, src, effect.condition)) continue;
    r.emit({ type: 'effect_activated', uid: c.uid, trigger: 'on_ko' });
    executeAction(r, src, effect.action);
  }
}
