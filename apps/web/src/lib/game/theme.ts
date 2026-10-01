import type { CategoryId, Rarity } from '@rabbithole/engine';

export const FONT = "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif";

export const COLORS = {
  bg: 0x0d0a14,
  zone: 0x171225,
  zoneLine: 0x3a2f55,
  zoneDrop: 0x2b2147,
  zoneDropActive: 0x45307a,
  terrain: 0x231a38,
  terrainHidden: 0x15101f,
  text: 0xf3eefc,
  muted: 0xa99cc4,
  mana: 0x4fb3ff,
  power: 0xffc94a,
  powerText: 0x1b1206,
  win: 0x3ddc97,
  lose: 0xff5c6c,
  accent: 0xff4fa3,
  cardBack: 0x24183d,
};

/** Couleur et symbole par catégorie (design typographique de la section 10.4). */
export const CATEGORY_STYLE: Record<CategoryId, { color: number; glyph: string }> = {
  nuits_exces: { color: 0xd63384, glyph: '☾' },
  crimes_scandales: { color: 0xd64545, glyph: '⚠' },
  mysteres: { color: 0x8e44ec, glyph: '?' },
  guerre_pouvoir: { color: 0xb08155, glyph: '♛' },
  sport: { color: 0x2fb36d, glyph: '⚑' },
  musique: { color: 0xff8a1f, glyph: '♪' },
  series_cinema: { color: 0x3b82f6, glyph: '▶' },
  internet: { color: 0x10c6e6, glyph: '@' },
  science: { color: 0x14b8a6, glyph: '⚛' },
  exploration: { color: 0x9aa63a, glyph: '▲' },
};

/**
 * Cadre de rareté distinct en forme ET en couleur (accessibilité daltonisme) :
 * rayon des coins, nombre de traits, ornements.
 */
export const RARITY_STYLE: Record<Rarity, { color: number; radius: number; lines: number; ornament: 'none' | 'dots' | 'diamonds' | 'crown' }> = {
  basique: { color: 0x8a8399, radius: 4, lines: 1, ornament: 'none' },
  tendance: { color: 0x3ddc97, radius: 16, lines: 1, ornament: 'none' },
  viral: { color: 0xff4fa3, radius: 10, lines: 2, ornament: 'dots' },
  iconique: { color: 0xffc94a, radius: 10, lines: 2, ornament: 'diamonds' },
  goat: { color: 0xfff1a8, radius: 10, lines: 3, ornament: 'crown' },
};

/** Assombrit une couleur (fond des cartes). */
export function shade(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
