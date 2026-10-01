import type { GlossaryLocale, LocalizedText } from '@rabbithole/engine';

/** i18n minimal du prototype : clés partout, FR et EN. L'i18n complète arrive en phase 8. */

const fr = {
  tagline: 'Fall into everything.',
  play: 'Jouer',
  rules: 'Règles',
  choose_deck: 'Choisis ton deck',
  opponent_ai: 'Adversaire : IA',
  end_turn: 'Fin de tour',
  waiting: 'Révélation…',
  turn: 'Tour',
  mana: 'Énergie',
  hype: 'Hype',
  fold: 'Lâcher',
  stake: 'Enjeu',
  you_reveal_first: 'Tu révèles en premier',
  they_reveal_first: "L'adversaire révèle en premier",
  victory: 'Victoire',
  defeat: 'Défaite',
  draw: 'Égalité',
  reason_terrains: '2 terrains sur 3',
  reason_total_power: 'Puissance totale',
  reason_draw: 'Égalité parfaite',
  reason_fold_you: 'Tu as lâché',
  reason_fold_them: "L'adversaire a lâché",
  rank_points: 'points de rang',
  play_again: 'Rejouer',
  menu: 'Menu',
  close: 'Fermer',
  rules_title: 'Les règles en 30 secondes',
  keywords_title: 'Mots-clés',
  revealed_on_turn: 'Révélé au tour {n}',
  cost: 'Coût',
  power: 'Puissance',
  hype_confirm: "Doubler l'enjeu ? Tu ne pourras le faire qu'une fois.",
  fold_confirm: "Lâcher la partie ? Tu perds l'enjeu actuel ({n}).",
  hype_banner: 'HYPE ! Enjeu ×{n}',
  turn_banner: 'Tour {n}',
  final_turn_banner: 'Dernier tour !',
  hint_drag: 'Glisse une carte sur un terrain',
  timer_off: 'Sans minuteur',
  opp_hand: 'Main adverse : {n}',
  rarity: 'Rareté',
  rarity_basique: 'Basique',
  rarity_tendance: 'Tendance',
  rarity_viral: 'Viral',
  rarity_iconique: 'Iconique',
  rarity_goat: 'GOAT',
} as const;

type Key = keyof typeof fr;

const en: Record<Key, string> = {
  tagline: 'Fall into everything.',
  play: 'Play',
  rules: 'Rules',
  choose_deck: 'Pick your deck',
  opponent_ai: 'Opponent: AI',
  end_turn: 'End turn',
  waiting: 'Revealing…',
  turn: 'Turn',
  mana: 'Energy',
  hype: 'Hype',
  fold: 'Fold',
  stake: 'Stakes',
  you_reveal_first: 'You reveal first',
  they_reveal_first: 'Opponent reveals first',
  victory: 'Victory',
  defeat: 'Defeat',
  draw: 'Draw',
  reason_terrains: '2 of 3 locations',
  reason_total_power: 'Total power',
  reason_draw: 'Perfect tie',
  reason_fold_you: 'You folded',
  reason_fold_them: 'Your opponent folded',
  rank_points: 'rank points',
  play_again: 'Play again',
  menu: 'Menu',
  close: 'Close',
  rules_title: 'The rules in 30 seconds',
  keywords_title: 'Keywords',
  revealed_on_turn: 'Revealed on turn {n}',
  cost: 'Cost',
  power: 'Power',
  hype_confirm: 'Double the stakes? You can only do this once.',
  fold_confirm: 'Fold? You lose the current stakes ({n}).',
  hype_banner: 'HYPE! Stakes ×{n}',
  turn_banner: 'Turn {n}',
  final_turn_banner: 'Final turn!',
  hint_drag: 'Drag a card onto a location',
  timer_off: 'No timer',
  opp_hand: 'Opponent hand: {n}',
  rarity: 'Rarity',
  rarity_basique: 'Basic',
  rarity_tendance: 'Trending',
  rarity_viral: 'Viral',
  rarity_iconique: 'Iconic',
  rarity_goat: 'GOAT',
};

export const locale: GlossaryLocale =
  typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('fr') ? 'en' : 'fr';

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const raw = (locale === 'fr' ? fr : en)[key];
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}

export function loc(text: LocalizedText | undefined): string {
  if (!text) return '';
  return text[locale] ?? text.fr ?? Object.values(text)[0] ?? '';
}
