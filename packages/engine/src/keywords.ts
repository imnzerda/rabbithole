import { executeAction } from './actions.js';
import { candidateTargets, hasKeyword, sourceOf } from './query.js';
import type { Resolver } from './resolver.js';
import type { CardInstance, KeywordId } from './types.js';

function trigger(r: Resolver, c: CardInstance, keyword: KeywordId, targets: string[]): void {
  r.emit({ type: 'keyword_triggered', uid: c.uid, keyword, targets });
}

/** La carte a encore quelque chose à perdre face à Cancel. */
function hasAbilities(r: Resolver, c: CardInstance): boolean {
  const def = r.defOf(c);
  return def.effects.length > 0 || def.keywords.length > 0;
}

/**
 * Mots-clés « Jouée », résolus avant les effets [Jouée] du DSL :
 * Rickroll → Cancel → Séduction → Shitpost.
 */
export function onPlayKeywords(r: Resolver, c: CardInstance): void {
  const k = r.ctx.rules.keywords;
  const src = sourceOf(c);
  const alive = () => c.zone === 'field' && !c.effectsCancelled;

  if (hasKeyword(r.ctx, c, 'rickroll') && alive()) {
    const pool = candidateTargets(r.ctx, r.s, src, 'enemies', { rested: false, maxCost: k.rickroll.maxCost });
    if (pool.length) {
      const target = r.extreme(pool, 'max');
      trigger(r, c, 'rickroll', [target]);
      r.rest(target, c.uid);
    }
  }

  if (hasKeyword(r.ctx, c, 'cancel') && alive()) {
    const pool = candidateTargets(r.ctx, r.s, src, 'enemies', undefined).filter((e) => !e.effectsCancelled && hasAbilities(r, e));
    if (pool.length) {
      const target = r.extreme(pool, 'max');
      trigger(r, c, 'cancel', [target]);
      r.cancelEffects(target, c.uid);
    }
  }

  if (hasKeyword(r.ctx, c, 'seduction') && alive()) {
    const pool = candidateTargets(r.ctx, r.s, src, 'enemies', { maxCost: k.seduction.maxCost });
    if (pool.length && r.s.players[c.controller].characters.length < r.ctx.rules.maxCharacters) {
      const target = r.extreme(pool, 'min');
      trigger(r, c, 'seduction', [target]);
      r.steal(target, c.controller, c.uid);
    }
  }

  if (hasKeyword(r.ctx, c, 'shitpost') && alive()) {
    const table = k.shitpost.table;
    const index = r.rng.weighted(table.map((e) => e.weight));
    trigger(r, c, 'shitpost', []);
    r.emit({ type: 'random_choice', source: c.uid, index, of: table.length });
    executeAction(r, src, table[index]!.action);
  }
}

/** Mots-clés « Attaque » : Clickbait (+2 pendant ce combat). */
export function onAttackKeywords(r: Resolver, c: CardInstance): void {
  if (hasKeyword(r.ctx, c, 'clickbait')) {
    trigger(r, c, 'clickbait', [c.uid]);
    r.addPower(c.uid, r.ctx.rules.keywords.clickbait.bonus, 'battle', c.uid);
  }
}
