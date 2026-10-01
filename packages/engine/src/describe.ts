import type { MatchContext } from './context.js';
import { keywordText, type GlossaryLocale } from './glossary.js';
import type { Action, Amount, CardDef, CardFilter, CategoryId, Condition, Effect, Side, TargetSelector, Trigger } from './types.js';

export const CATEGORY_NAMES: Record<CategoryId, Record<GlossaryLocale, string>> = {
  nuits_exces: { fr: 'Nuits et excès', en: 'Nights & Excess' },
  crimes_scandales: { fr: 'Crimes et scandales', en: 'Crimes & Scandals' },
  mysteres: { fr: 'Mystères et complots', en: 'Mysteries & Conspiracies' },
  guerre_pouvoir: { fr: 'Guerre et pouvoir', en: 'War & Power' },
  sport: { fr: 'Sport', en: 'Sports' },
  musique: { fr: 'Musique', en: 'Music' },
  series_cinema: { fr: 'Séries et cinéma', en: 'TV & Movies' },
  internet: { fr: 'Internet et jeux vidéo', en: 'Internet & Gaming' },
  science: { fr: 'Science et technologie', en: 'Science & Tech' },
  exploration: { fr: 'Exploration et extrêmes', en: 'Exploration & Extremes' },
};

export const KEYWORD_NAMES: Record<string, Record<GlossaryLocale, string>> = {
  viral: { fr: 'Viral', en: 'Viral' },
  ratio: { fr: 'Ratio', en: 'Ratio' },
  cancel: { fr: 'Cancel', en: 'Cancel' },
  clickbait: { fr: 'Clickbait', en: 'Clickbait' },
  rickroll: { fr: 'Rickroll', en: 'Rickroll' },
  shitpost: { fr: 'Shitpost', en: 'Shitpost' },
  seduction: { fr: 'Séduction', en: 'Seduction' },
  elan: { fr: 'Élan', en: 'Momentum' },
  croissance: { fr: 'Croissance', en: 'Growth' },
  tendance: { fr: 'Tendance', en: 'Trending' },
};

type Dict = Record<GlossaryLocale, string>;

const TRIGGER_PREFIX: Record<Trigger, Dict> = {
  on_reveal: { fr: 'À la révélation', en: 'On reveal' },
  continuous: { fr: 'Continu', en: 'Ongoing' },
  end_of_game: { fr: 'Fin de partie', en: 'End of game' },
  start_of_turn: { fr: 'Début de tour', en: 'Start of turn' },
  end_of_turn: { fr: 'Fin de tour', en: 'End of turn' },
};

const TARGETS: Record<TargetSelector, Dict> = {
  self: { fr: 'cette carte', en: 'this card' },
  allies_here: { fr: 'tes autres cartes ici', en: 'your other cards here' },
  enemies_here: { fr: 'les cartes adverses ici', en: 'enemy cards here' },
  opposite_card: { fr: 'la carte adverse en face', en: 'the enemy card opposite' },
  random_enemy_here: { fr: 'une carte adverse au hasard ici', en: 'a random enemy card here' },
  all_here: { fr: 'toutes les autres cartes ici', en: 'all other cards here' },
  strongest_enemy_here: { fr: 'la carte adverse la plus forte ici', en: 'the strongest enemy card here' },
  weakest_enemy_here: { fr: 'la carte adverse la plus faible ici', en: 'the weakest enemy card here' },
  hand: { fr: 'les cartes de ta main', en: 'cards in your hand' },
  deck: { fr: 'les cartes de ta pioche', en: 'cards in your deck' },
};

const ENEMY_ZONE: Partial<Record<TargetSelector, Dict>> = {
  hand: { fr: "les cartes de la main adverse", en: "cards in your opponent's hand" },
  deck: { fr: 'les cartes de la pioche adverse', en: "cards in your opponent's deck" },
};

const COUNT_ZONE: Record<string, Dict> = {
  allies_here: { fr: 'autre carte à toi ici', en: 'other card you have here' },
  enemies_here: { fr: 'carte adverse ici', en: 'enemy card here' },
  all_here: { fr: 'autre carte ici', en: 'other card here' },
  allies_everywhere: { fr: 'autre carte à toi en jeu', en: 'other card you have in play' },
  enemies_everywhere: { fr: 'carte adverse en jeu', en: 'enemy card in play' },
  hand: { fr: 'carte dans ta main', en: 'card in your hand' },
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

function filterText(f: CardFilter | undefined, l: GlossaryLocale): string {
  if (!f?.categories?.length) return '';
  return ` (${f.categories.map((c) => CATEGORY_NAMES[c][l]).join(l === 'fr' ? ' ou ' : ' or ')})`;
}

function targetText(a: { target: TargetSelector; filter?: CardFilter; side?: Side }, l: GlossaryLocale): string {
  const zone = a.side === 'enemy' ? ENEMY_ZONE[a.target] : undefined;
  return (zone ?? TARGETS[a.target])[l] + filterText(a.filter, l);
}

function amountText(amount: Amount, l: GlossaryLocale): string {
  if (typeof amount === 'number') return signed(amount);
  const per = amount.multiplier ?? 1;
  const base = amount.base ? `${signed(amount.base)} ` : '';
  const zone = COUNT_ZONE[amount.zone]?.[l] ?? amount.zone;
  return l === 'fr'
    ? `${base}${signed(per)} par ${zone}${filterText(amount.filter, l)}`
    : `${base}${signed(per)} per ${zone}${filterText(amount.filter, l)}`;
}

function cardNames(ctx: MatchContext | undefined, ids: string[], l: GlossaryLocale): string {
  return ids.map((id) => ctx?.cards[id]?.name[l] ?? ctx?.cards[id]?.name.fr ?? id).join(l === 'fr' ? ' ou ' : ' or ');
}

function conditionText(c: Condition, l: GlossaryLocale): string {
  switch (c.type) {
    case 'terrain_has_category': {
      const who =
        c.side === 'allies' ? { fr: ' à toi', en: ' of yours' } : c.side === 'enemies' ? { fr: ' adverse(s)', en: ' enemy' } : { fr: '', en: '' };
      const cat = CATEGORY_NAMES[c.category][l];
      return l === 'fr' ? `s'il y a au moins ${c.min} autre(s) carte(s) ${cat}${who.fr} ici` : `if there are at least ${c.min} other${who.en} ${cat} card(s) here`;
    }
    case 'count': {
      const zone = COUNT_ZONE[c.zone]?.[l] ?? c.zone;
      const min = c.min ?? 0;
      return l === 'fr' ? `s'il y a au moins ${min} ${zone}${filterText(c.filter, l)}` : `if there is at least ${min} ${zone}${filterText(c.filter, l)}`;
    }
    case 'turn':
      if (c.min !== undefined && c.max !== undefined) return l === 'fr' ? `aux tours ${c.min} à ${c.max}` : `on turns ${c.min} to ${c.max}`;
      if (c.min !== undefined) return l === 'fr' ? `à partir du tour ${c.min}` : `from turn ${c.min}`;
      return l === 'fr' ? `jusqu'au tour ${c.max}` : `until turn ${c.max}`;
    case 'hand_size':
      return l === 'fr' ? 'selon la taille de la main' : 'depending on hand size';
    case 'and':
      return c.conditions.map((x) => conditionText(x, l)).join(l === 'fr' ? ' et ' : ' and ');
    case 'or':
      return c.conditions.map((x) => conditionText(x, l)).join(l === 'fr' ? ' ou ' : ' or ');
    default:
      return l === 'fr' ? 'sous condition' : 'under a condition';
  }
}

export function actionText(a: Action, l: GlossaryLocale, ctx?: MatchContext): string {
  const fr = l === 'fr';
  switch (a.type) {
    case 'add_power':
      if (a.target === 'self') return fr ? `gagne ${amountText(a.amount, l)}` : `gains ${amountText(a.amount, l)}`;
      return fr ? `${amountText(a.amount, l)} à ${targetText(a, l)}` : `${amountText(a.amount, l)} to ${targetText(a, l)}`;
    case 'set_power':
      return fr ? `${targetText(a, l)} passe à ${typeof a.amount === 'number' ? a.amount : '?'} de puissance` : `set ${targetText(a, l)} to ${typeof a.amount === 'number' ? a.amount : '?'} power`;
    case 'destroy':
      return fr ? `détruit ${targetText(a, l)}` : `destroy ${targetText(a, l)}`;
    case 'move': {
      const dest = a.to === 'random_other' ? (fr ? 'sur un autre terrain' : 'to another location') : a.to === 'left' ? (fr ? 'sur le terrain de gauche' : 'to the left location') : fr ? 'sur le terrain de droite' : 'to the right location';
      return fr ? `envoie ${targetText(a, l)} ${dest}` : `move ${targetText(a, l)} ${dest}`;
    }
    case 'copy': {
      const where = a.to === 'hand' ? (fr ? 'dans ta main' : 'into your hand') : a.to === 'random_other' ? (fr ? 'sur un autre terrain' : 'on another location') : fr ? 'ici' : 'here';
      const delta = a.powerDelta ? ` (${signed(a.powerDelta)})` : '';
      return fr ? `ajoute une copie de ${targetText(a, l)}${delta} ${where}` : `add a copy of ${targetText(a, l)}${delta} ${where}`;
    }
    case 'transform':
      return fr ? `transforme ${targetText(a, l)} en ${cardNames(ctx, a.into, l)}` : `transform ${targetText(a, l)} into ${cardNames(ctx, a.into, l)}`;
    case 'steal':
      return fr ? `vole ${targetText(a, l)}` : `steal ${targetText(a, l)}`;
    case 'hide':
      return fr ? `cache ${targetText(a, l)} à l'adversaire` : `hide ${targetText(a, l)} from your opponent`;
    case 'cancel_effects':
      return fr ? `${targetText(a, l)} perd ses effets` : `${targetText(a, l)} loses its effects`;
    case 'draw': {
      const n = a.amount;
      if (a.side === 'enemy') return fr ? `l'adversaire pioche ${n} carte${n > 1 ? 's' : ''}` : `your opponent draws ${n} card${n > 1 ? 's' : ''}`;
      return fr ? `pioche ${n} carte${n > 1 ? 's' : ''}` : `draw ${n} card${n > 1 ? 's' : ''}`;
    }
    case 'discard': {
      const n = a.amount;
      const who = a.side === 'enemy' ? (fr ? "l'adversaire défausse" : 'your opponent discards') : fr ? 'défausse' : 'discard';
      const how =
        a.pick === 'highest_cost' ? (fr ? ' (la plus chère)' : ' (most expensive)') : a.pick === 'lowest_cost' ? (fr ? ' (la moins chère)' : ' (cheapest)') : fr ? ' au hasard' : ' at random';
      return `${who} ${n} ${fr ? 'carte' : 'card'}${n > 1 ? 's' : ''}${how}`;
    }
    case 'add_card_to_hand': {
      const who = a.side === 'enemy' ? (fr ? 'la main adverse' : "your opponent's hand") : fr ? 'ta main' : 'your hand';
      return fr ? `ajoute ${cardNames(ctx, a.cards, l)} à ${who}` : `add ${cardNames(ctx, a.cards, l)} to ${who}`;
    }
    case 'random_of':
      return (fr ? 'au hasard : ' : 'at random: ') + a.options.map((o) => actionText(o, l, ctx)).join(fr ? ' ; ou ' : '; or ');
  }
}

/** Une phrase par effet, ex. « À la révélation : +3 à cette carte s'il y a au moins 2 autres cartes Musique ici. » */
export function effectText(e: Effect, l: GlossaryLocale = 'fr', ctx?: MatchContext): string {
  const cond = e.condition ? ` ${conditionText(e.condition, l)}` : '';
  return `${TRIGGER_PREFIX[e.trigger][l]} : ${capitalize(actionText(e.action, l, ctx))}${cond}.`.replace(' : ', l === 'fr' ? ' : ' : ': ');
}

export interface CardTextLine {
  keyword?: string;
  text: string;
}

/** Texte complet d'une carte : mots-clés (nom + règle) puis effets du DSL. */
export function cardText(ctx: MatchContext, def: CardDef, l: GlossaryLocale = 'fr'): CardTextLine[] {
  return [
    ...def.keywords.map((k) => ({ keyword: KEYWORD_NAMES[k]?.[l] ?? k, text: keywordText(ctx.rules, k, l) })),
    ...def.effects.map((e) => ({ text: effectText(e, l, ctx) })),
  ];
}
