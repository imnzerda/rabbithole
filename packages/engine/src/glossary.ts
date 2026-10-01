import type { RulesConfig } from './rules.js';
import type { KeywordId } from './types.js';

export type GlossaryLocale = 'fr' | 'en';

/** Écart min/max de Shitpost si la table ne contient que des bonus sur soi, sinon `null`. */
function shitpostRange(rules: RulesConfig): [number, number] | null {
  const amounts: number[] = [];
  for (const { action } of rules.keywords.shitpost.table) {
    if (action.type !== 'add_power' || action.target !== 'self' || typeof action.amount !== 'number') return null;
    amounts.push(action.amount);
  }
  return amounts.length ? [Math.min(...amounts), Math.max(...amounts)] : null;
}

/**
 * Texte de règle d'un mot-clé en une phrase, généré depuis la config :
 * le texte affiché sur la carte reste toujours fidèle aux valeurs d'équilibrage.
 */
export function keywordText(rules: RulesConfig, keyword: KeywordId, locale: GlossaryLocale = 'fr'): string {
  const k = rules.keywords;
  const range = shitpostRange(rules);
  const fr: Record<KeywordId, string> = {
    viral: `Crée une copie de cette carte (−${k.viral.powerPenalty}) sur un autre terrain.`,
    ratio: `La carte adverse la plus forte ici perd ${k.ratio.amount}.`,
    cancel: `La carte adverse la plus forte ici perd ses effets.`,
    clickbait: `+${k.clickbait.bonus} jusqu'à la fin du tour suivant.`,
    rickroll: `Envoie la carte adverse la plus forte ici sur un autre terrain.`,
    shitpost: range ? `Gagne entre +${range[0]} et +${range[1]} au hasard.` : `Un effet au hasard.`,
    seduction: `Vole la carte adverse la plus faible ici.`,
    elan: `+${k.elan.bonus} si jouée aux tours 1 à ${k.elan.maxTurn}.`,
    croissance: `+${k.croissance.perTurn} à la fin de chaque tour.`,
    tendance: `+${k.tendance.bonus} aujourd'hui : cette carte est en tendance.`,
  };
  const en: Record<KeywordId, string> = {
    viral: `Creates a copy of this card (−${k.viral.powerPenalty}) on another location.`,
    ratio: `The strongest enemy card here loses ${k.ratio.amount}.`,
    cancel: `The strongest enemy card here loses its effects.`,
    clickbait: `+${k.clickbait.bonus} until the end of next turn.`,
    rickroll: `Sends the strongest enemy card here to another location.`,
    shitpost: range ? `Gains +${range[0]} to +${range[1]} at random.` : `A random effect.`,
    seduction: `Steals the weakest enemy card here.`,
    elan: `+${k.elan.bonus} if played on turns 1 to ${k.elan.maxTurn}.`,
    croissance: `+${k.croissance.perTurn} at the end of each turn.`,
    tendance: `+${k.tendance.bonus} today: this card is trending.`,
  };
  return (locale === 'fr' ? fr : en)[keyword];
}

/** Les règles du jeu en quelques lignes, pour le tutoriel et l'écran d'aide. */
export function rulesSummary(rules: RulesConfig, locale: GlossaryLocale = 'fr'): string[] {
  const h = rules.hype;
  const maxHype = Math.min(h.maxStake, h.baseStake * h.multiplier ** 2);
  if (locale === 'en') {
    return [
      `Win ${rules.terrainsToWin} of the ${rules.terrainCount} locations: have more power than your opponent there.`,
      `${rules.turns} turns. Each turn you get as much energy as the turn number.`,
      `Both players play at the same time, then everything is revealed.`,
      `A new location appears on each of the first ${rules.terrainCount} turns. Max ${rules.maxCardsPerTerrain} cards per side.`,
      `Hype: double the stakes (once each, up to ×${maxHype}). Fold anytime to lose only the current stakes.`,
    ];
  }
  return [
    `Gagne ${rules.terrainsToWin} des ${rules.terrainCount} terrains : aie plus de puissance que l'adversaire dessus.`,
    `${rules.turns} tours. À chaque tour, tu as autant d'énergie que le numéro du tour.`,
    `Les deux joueurs jouent en même temps, puis tout est révélé.`,
    `Un nouveau terrain apparaît à chacun des ${rules.terrainCount} premiers tours. ${rules.maxCardsPerTerrain} cartes max par camp.`,
    `Hype : double l'enjeu (une fois chacun, jusqu'à ×${maxHype}). Lâche quand tu veux pour ne perdre que l'enjeu actuel.`,
  ];
}
