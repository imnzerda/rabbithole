import type { MatchContext } from './context.js';
import type { RulesConfig } from './rules.js';
import type {
  Action,
  Amount,
  CardDef,
  CardFilter,
  CategoryId,
  Condition,
  Duration,
  Effect,
  KeywordId,
  TargetSelector,
  Trigger,
} from './types.js';

export type GlossaryLocale = 'fr' | 'en';
type Dict = Record<GlossaryLocale, string>;

export const CATEGORY_NAMES: Record<CategoryId, Dict> = {
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

export const KEYWORD_NAMES: Record<KeywordId, Dict> = {
  elan: { fr: 'Élan', en: 'Rush' },
  bloqueur: { fr: 'Bloqueur', en: 'Blocker' },
  viral: { fr: 'Viral', en: 'Viral' },
  ratio: { fr: 'Ratio', en: 'Ratio' },
  clickbait: { fr: 'Clickbait', en: 'Clickbait' },
  croissance: { fr: 'Croissance', en: 'Growth' },
  rickroll: { fr: 'Rickroll', en: 'Rickroll' },
  cancel: { fr: 'Cancel', en: 'Cancel' },
  seduction: { fr: 'Séduction', en: 'Seduction' },
  shitpost: { fr: 'Shitpost', en: 'Shitpost' },
  tendance: { fr: 'Tendance', en: 'Trending' },
};

const TRIGGER_LABEL: Record<Trigger, Dict> = {
  on_play: { fr: 'Jouée', en: 'On Play' },
  on_attack: { fr: 'Attaque', en: 'When Attacking' },
  on_ko: { fr: 'KO', en: 'On K.O.' },
  on_trigger: { fr: 'Déclencheur', en: 'Trigger' },
  continuous: { fr: 'Continu', en: 'Ongoing' },
  activate_main: { fr: 'Activation : principale', en: 'Activate: Main' },
  end_of_turn: { fr: 'Fin de ton tour', en: 'End of Your Turn' },
  main: { fr: 'Principale', en: 'Main' },
  counter: { fr: 'Contre', en: 'Counter' },
};

const TARGETS: Record<TargetSelector, Dict> = {
  self: { fr: 'cette carte', en: 'this card' },
  my_leader: { fr: 'ton Leader', en: 'your Leader' },
  enemy_leader: { fr: 'le Leader adverse', en: "your opponent's Leader" },
  allies: { fr: 'tes autres Personnages', en: 'your other Characters' },
  enemies: { fr: 'les Personnages adverses', en: "your opponent's Characters" },
  all_mine: { fr: 'ton Leader et tes Personnages', en: 'your Leader and Characters' },
  strongest_enemy: { fr: 'le Personnage adverse le plus fort', en: "your opponent's strongest Character" },
  weakest_enemy: { fr: 'le Personnage adverse le plus faible', en: "your opponent's weakest Character" },
  random_enemy: { fr: 'un Personnage adverse au hasard', en: "a random opposing Character" },
  strongest_ally: { fr: 'ton Personnage le plus fort', en: 'your strongest Character' },
  weakest_ally: { fr: 'ton Personnage le plus faible', en: 'your weakest Character' },
  battle_target: { fr: 'ta carte attaquée', en: 'your attacked card' },
  attacker: { fr: "l'attaquant", en: 'the attacker' },
};

const COUNT_ZONE: Record<string, Dict> = {
  allies: { fr: 'autre Personnage à toi', en: 'other Character you have' },
  enemies: { fr: 'Personnage adverse', en: 'opposing Character' },
  hand: { fr: 'carte dans ta main', en: 'card in your hand' },
  enemy_hand: { fr: 'carte dans la main adverse', en: "card in your opponent's hand" },
  life: { fr: 'Vie qu’il te reste', en: 'Life you have' },
  enemy_life: { fr: 'Vie adverse', en: 'opposing Life' },
  trash: { fr: 'carte dans ta défausse', en: 'card in your trash' },
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

// ---------------------------------------------------------------------------
// Mots-clés et règles
// ---------------------------------------------------------------------------

/** Effet d'un mot-clé en une phrase, généré depuis la config. */
export function keywordText(rules: RulesConfig, keyword: KeywordId, l: GlossaryLocale = 'fr'): string {
  const k = rules.keywords;
  const shitpost = k.shitpost.table.map((e) => actionText(e.action, l)).join(l === 'fr' ? ', ou ' : ', or ');
  const fr: Record<KeywordId, string> = {
    elan: 'Peut attaquer dès le tour où elle est jouée.',
    bloqueur: "Quand l'adversaire attaque, tu peux l'épuiser pour qu'elle devienne la cible.",
    viral: `Quand elle touche le Leader adverse, il perd ${k.viral.damage} Vies.`,
    ratio: 'Les Vies qu’elle retire vont à la défausse : ni Déclencheur, ni carte en main.',
    clickbait: `${signed(k.clickbait.bonus)} quand elle attaque.`,
    croissance: `${signed(k.croissance.perTurn)} définitif à la fin de chacun de tes tours.`,
    rickroll: `[Jouée] Épuise le Personnage adverse actif le plus fort (coût ${k.rickroll.maxCost} max).`,
    cancel: '[Jouée] Le Personnage adverse le plus fort perd ses effets.',
    seduction: `[Jouée] Vole le Personnage adverse le plus faible (coût ${k.seduction.maxCost} max).`,
    shitpost: `[Jouée] Au hasard : ${shitpost}.`,
    tendance: `${signed(k.tendance.bonus)} aujourd'hui : cette carte est en tendance.`,
  };
  const en: Record<KeywordId, string> = {
    elan: 'Can attack the turn it is played.',
    bloqueur: 'When your opponent attacks, you may rest it to make it the target.',
    viral: `When it hits the opposing Leader, they lose ${k.viral.damage} Life.`,
    ratio: 'Life it removes goes to the trash: no Trigger, no card to hand.',
    clickbait: `${signed(k.clickbait.bonus)} when attacking.`,
    croissance: `${signed(k.croissance.perTurn)} permanently at the end of each of your turns.`,
    rickroll: `[On Play] Rest your opponent's strongest active Character (cost ${k.rickroll.maxCost} or less).`,
    cancel: "[On Play] Your opponent's strongest Character loses its effects.",
    seduction: `[On Play] Steal your opponent's weakest Character (cost ${k.seduction.maxCost} or less).`,
    shitpost: `[On Play] At random: ${shitpost}.`,
    tendance: `${signed(k.tendance.bonus)} today: this card is trending.`,
  };
  return (l === 'fr' ? fr : en)[keyword];
}

/** Les règles du jeu en quelques lignes, pour le tutoriel et l'écran d'aide. */
export function rulesSummary(rules: RulesConfig, l: GlossaryLocale = 'fr'): string[] {
  const h = rules.hype;
  const maxHype = Math.min(h.maxStake, h.baseStake * h.multiplier ** 2);
  if (l === 'en') {
    return [
      "Knock out your opponent's Leader: take all their Life, then hit them one more time.",
      `Each turn: your cards stand up, you draw 1 card and gain ${rules.buzzPerTurn} Buzz (max ${rules.buzzTotal}).`,
      `Spend Buzz to play Characters and Events, or attach it to a card (+${rules.buzzPower} power during your turn).`,
      "Attack with your Leader or Characters: target the opposing Leader or a rested Character. An attack succeeds if its power is equal or higher.",
      'When attacked: block with a Blocker, then discard Counter cards to boost your defense.',
      'Each Life you lose goes to your hand — unless you activate its Trigger.',
      `Hype: double the stakes (once each, up to ×${maxHype}). Fold anytime to lose only the current stakes.`,
    ];
  }
  return [
    'Mets KO le Leader adverse : retire-lui toutes ses Vies, puis touche-le une dernière fois.',
    `Chaque tour : tes cartes se redressent, tu pioches 1 carte et gagnes ${rules.buzzPerTurn} Buzz (${rules.buzzTotal} max).`,
    `Dépense ton Buzz pour jouer des Personnages et des Événements, ou attache-le à une carte (+${rules.buzzPower} de puissance pendant ton tour).`,
    "Attaque avec ton Leader ou tes Personnages : la cible est le Leader adverse ou un Personnage épuisé. L'attaque réussit si sa puissance est au moins égale.",
    "Quand on t'attaque : bloque avec un Bloqueur, puis défausse des cartes Contre pour renforcer ta défense.",
    'Chaque Vie perdue arrive dans ta main — sauf si tu actives son Déclencheur.',
    `Hype : double l'enjeu (une fois chacun, jusqu'à ×${maxHype}). Lâche quand tu veux pour ne perdre que l'enjeu actuel.`,
  ];
}

// ---------------------------------------------------------------------------
// Texte des effets (DSL → phrase)
// ---------------------------------------------------------------------------

function filterText(f: CardFilter | undefined, l: GlossaryLocale): string {
  if (!f) return '';
  const parts: string[] = [];
  if (f.categories?.length) parts.push(f.categories.map((c) => CATEGORY_NAMES[c][l]).join(l === 'fr' ? ' ou ' : ' or '));
  if (f.keywords?.length) parts.push(f.keywords.map((k) => KEYWORD_NAMES[k][l]).join(l === 'fr' ? ' ou ' : ' or '));
  if (f.maxCost !== undefined) parts.push(l === 'fr' ? `coût ${f.maxCost} max` : `cost ${f.maxCost} or less`);
  if (f.maxPower !== undefined) parts.push(l === 'fr' ? `puissance ${f.maxPower} max` : `power ${f.maxPower} or less`);
  if (f.rested === true) parts.push(l === 'fr' ? 'épuisé' : 'rested');
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function targetText(a: { target: TargetSelector; filter?: CardFilter }, l: GlossaryLocale): string {
  return TARGETS[a.target][l] + filterText(a.filter, l);
}

function amountText(amount: Amount, l: GlossaryLocale): string {
  if (typeof amount === 'number') return signed(amount);
  const zone = COUNT_ZONE[amount.zone]?.[l] ?? amount.zone;
  const base = amount.base ? `${signed(amount.base)} ` : '';
  return `${base}${signed(amount.multiplier ?? 1)} ${l === 'fr' ? 'par' : 'per'} ${zone}${filterText(amount.filter, l)}`;
}

function durationText(d: Duration | undefined, l: GlossaryLocale): string {
  switch (d ?? 'turn') {
    case 'turn':
      return l === 'fr' ? " jusqu'à la fin du tour" : ' until end of turn';
    case 'battle':
      return l === 'fr' ? ' pendant ce combat' : ' during this battle';
    case 'permanent':
      return l === 'fr' ? ' (définitif)' : ' (permanent)';
  }
}

function cardNames(ctx: MatchContext | undefined, ids: string[], l: GlossaryLocale): string {
  return ids.map((id) => ctx?.cards[id]?.name[l] ?? ctx?.cards[id]?.name.fr ?? id).join(l === 'fr' ? ' ou ' : ' or ');
}

function conditionText(c: Condition, l: GlossaryLocale): string {
  const fr = l === 'fr';
  switch (c.type) {
    case 'count': {
      const zone = COUNT_ZONE[c.zone]?.[l] ?? c.zone;
      if (c.max !== undefined && c.min === undefined) return fr ? `si tu as ${c.max} ${zone} ou moins` : `if you have ${c.max} or fewer ${zone}`;
      return fr ? `si tu as au moins ${c.min ?? 1} ${zone}${filterText(c.filter, l)}` : `if you have at least ${c.min ?? 1} ${zone}${filterText(c.filter, l)}`;
    }
    case 'my_turn':
      return fr ? 'pendant ton tour' : 'during your turn';
    case 'opponent_turn':
      return fr ? "pendant le tour adverse" : "during your opponent's turn";
    case 'buzz_attached':
      return fr ? `si elle a au moins ${c.min} Buzz attaché${c.min > 1 ? 's' : ''}` : `if it has ${c.min}+ Buzz attached`;
    case 'attacking_leader':
      return fr ? 'si elle attaque le Leader' : 'if attacking the Leader';
    case 'and':
      return c.conditions.map((x) => conditionText(x, l)).join(fr ? ' et ' : ' and ');
    case 'or':
      return c.conditions.map((x) => conditionText(x, l)).join(fr ? ' ou ' : ' or ');
    case 'not':
      return fr ? `sauf ${conditionText(c.condition, l)}` : `unless ${conditionText(c.condition, l)}`;
  }
}

export function actionText(a: Action, l: GlossaryLocale = 'fr', ctx?: MatchContext, continuous = false): string {
  const fr = l === 'fr';
  switch (a.type) {
    case 'add_power':
    {
      // Un effet continu n'a pas de durée : il s'applique tant que la carte est en jeu.
      const duration = continuous ? '' : durationText(a.duration, l);
      if (a.target === 'self') return `${fr ? 'gagne' : 'gains'} ${amountText(a.amount, l)}${duration}`;
      return `${amountText(a.amount, l)} ${fr ? 'à' : 'to'} ${targetText(a, l)}${duration}`;
    }
    case 'ko':
      return fr ? `met KO ${targetText(a, l)}` : `K.O. ${targetText(a, l)}`;
    case 'rest':
      return fr ? `épuise ${targetText(a, l)}` : `rest ${targetText(a, l)}`;
    case 'refresh':
      return fr ? `redresse ${targetText(a, l)}` : `set ${targetText(a, l)} as active`;
    case 'bounce':
      return fr ? `renvoie ${targetText(a, l)} dans la main de son propriétaire` : `return ${targetText(a, l)} to its owner's hand`;
    case 'steal':
      return fr ? `vole ${targetText(a, l)}` : `take control of ${targetText(a, l)}`;
    case 'cancel_effects':
      return fr ? `${targetText(a, l)} perd ses effets` : `${targetText(a, l)} loses its effects`;
    case 'draw':
      if (a.side === 'enemy') return fr ? `l'adversaire pioche ${plural(a.amount, 'carte')}` : `your opponent draws ${plural(a.amount, 'card')}`;
      return fr ? `pioche ${plural(a.amount, 'carte')}` : `draw ${plural(a.amount, 'card')}`;
    case 'discard': {
      const how =
        a.pick === 'highest_cost' ? (fr ? ' (la plus chère)' : ' (most expensive)') : a.pick === 'lowest_cost' ? (fr ? ' (la moins chère)' : ' (cheapest)') : fr ? ' au hasard' : ' at random';
      const who = a.side === 'enemy' ? (fr ? "l'adversaire défausse" : 'your opponent discards') : fr ? 'défausse' : 'discard';
      return `${who} ${plural(a.amount, fr ? 'carte' : 'card')}${how}`;
    }
    case 'add_card_to_hand':
      return fr ? `ajoute ${cardNames(ctx, a.cards, l)} à ta main` : `add ${cardNames(ctx, a.cards, l)} to your hand`;
    case 'add_buzz':
      return fr ? `gagne ${a.amount} Buzz (épuisé)` : `gain ${a.amount} rested Buzz`;
    case 'random_of':
      return (fr ? 'au hasard : ' : 'at random: ') + a.options.map((o) => actionText(o, l, ctx)).join(fr ? ', ou ' : ', or ');
  }
}

/** Ex. « [Jouée] Met KO le Personnage adverse le plus fort (coût 5 max). » */
export function effectText(e: Effect, l: GlossaryLocale = 'fr', ctx?: MatchContext): string {
  const fr = l === 'fr';
  const tags = [`[${TRIGGER_LABEL[e.trigger][l]}]`];
  let condition = e.condition;
  if (condition?.type === 'my_turn' || condition?.type === 'opponent_turn') {
    tags.push(condition.type === 'my_turn' ? (fr ? '[Ton tour]' : '[Your Turn]') : fr ? '[Tour adverse]' : "[Opponent's Turn]");
    condition = undefined;
  }
  if (e.trigger === 'activate_main') tags.push(fr ? '[1 fois par tour]' : '[Once Per Turn]');
  const cost = e.buzzCost ? (fr ? `Dépense ${e.buzzCost} Buzz : ` : `Spend ${e.buzzCost} Buzz: `) : '';
  const cond = condition ? ` ${conditionText(condition, l)}` : '';
  return `${tags.join(' ')} ${cost}${capitalize(actionText(e.action, l, ctx, e.trigger === 'continuous'))}${cond}.`;
}

export interface CardTextLine {
  keyword?: string;
  text: string;
}

/** Texte complet d'une carte : mots-clés (nom + règle) puis effets du DSL. */
export function cardText(ctx: MatchContext, def: CardDef, l: GlossaryLocale = 'fr'): CardTextLine[] {
  return [
    ...def.keywords.map((k) => ({ keyword: KEYWORD_NAMES[k][l], text: keywordText(ctx.rules, k, l) })),
    ...def.effects.map((e) => ({ text: effectText(e, l, ctx) })),
  ];
}
