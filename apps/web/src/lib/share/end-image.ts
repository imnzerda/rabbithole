import type { CardDef, CategoryId, MatchResult, PlayerIndex } from '@rabbithole/engine';
import { CATEGORY_STYLE, COLORS, FONT } from '../game/theme';

/**
 * Image de fin de partie à partager (section 15, partage) : format vertical 9:16 (1080 × 1920), design
 * typographique du jeu, sans information cachée (seulement ce que la fin de partie montre aux deux joueurs).
 * Pur rendu : aucune logique de jeu.
 */

export interface EndImageSide {
  name: string;
  leader: CardDef;
  /** Vies restantes et Vies de départ. */
  life: number;
  startLife: number;
}

export interface EndImageInput {
  result: MatchResult;
  you: PlayerIndex;
  me: EndImageSide;
  opponent: EndImageSide;
  /** Textes déjà traduits. */
  labels: { outcome: string; reason: string; turns: string; mode: string | null; tagline: string; you: string; date: string; board: string };
  /** Personnages encore en jeu à la fin (les miens), du plus fort au plus faible. */
  board: { name: string; power: number; category: CategoryId | undefined }[];
  /** Nom localisé d'une carte. */
  nameOf: (def: CardDef) => string;
}

export const END_IMAGE_SIZE = { width: 1080, height: 1920 };

const hex = (n: number, alpha = 1) => `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Texte tronqué avec « … » pour tenir dans `max` pixels. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Texte sur plusieurs lignes (au plus `lines`), centré sur `x`. */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lineHeight: number, lines: number): void {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > max && line) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  const shown = out.slice(0, lines);
  if (out.length > lines) shown[lines - 1] = fit(g, `${shown[lines - 1]} ${out.slice(lines).join(' ')}`, max);
  shown.forEach((l, i) => g.fillText(l, x, y + i * lineHeight));
}

/** Leader en carte typographique : couleur et symbole de sa catégorie, nom, joueur, Vies. */
function leaderCard(g: CanvasRenderingContext2D, side: EndImageSide, x: number, y: number, w: number, h: number, nameOf: (d: CardDef) => string, caption: string, won: boolean): void {
  const cat = CATEGORY_STYLE[side.leader.categories[0] as CategoryId] ?? { color: COLORS.accent, glyph: '★' };
  g.save();
  g.shadowColor = hex(won ? COLORS.win : cat.color, 0.55);
  g.shadowBlur = won ? 60 : 30;
  roundRect(g, x, y, w, h, 36);
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, hex(cat.color, 0.95));
  grad.addColorStop(1, hex(COLORS.cardBack, 1));
  g.fillStyle = grad;
  g.fill();
  g.restore();
  g.lineWidth = won ? 8 : 4;
  g.strokeStyle = won ? hex(COLORS.win) : hex(COLORS.text, 0.35);
  roundRect(g, x, y, w, h, 36);
  g.stroke();

  g.textAlign = 'center';
  g.fillStyle = hex(COLORS.text, 0.25);
  g.font = `700 200px ${FONT}`;
  g.fillText(cat.glyph, x + w / 2, y + 250);
  g.fillStyle = hex(COLORS.text);
  g.font = `700 46px ${FONT}`;
  wrap(g, nameOf(side.leader), x + w / 2, y + 340, w - 50, 52, 2);
  g.fillStyle = hex(COLORS.text, 0.8);
  g.font = `500 34px ${FONT}`;
  g.fillText(fit(g, side.name, w - 40), x + w / 2, y + h - 110);
  g.fillStyle = hex(COLORS.muted);
  g.font = `600 26px ${FONT}`;
  g.fillText(caption, x + w / 2, y + h - 150);
  // Vies : pleines (restantes) et vides (perdues).
  g.font = `400 40px ${FONT}`;
  const hearts = '♥'.repeat(Math.max(0, side.life)) + '♡'.repeat(Math.max(0, side.startLife - side.life));
  g.fillStyle = hex(COLORS.lose);
  g.fillText(hearts, x + w / 2, y + h - 50);
}

export function drawEndImage(g: CanvasRenderingContext2D, input: EndImageInput): void {
  const { width: W, height: H } = END_IMAGE_SIZE;
  const won = input.result.winner === input.you;
  const draw = input.result.winner === null;
  const tone = draw ? COLORS.muted : won ? COLORS.win : COLORS.lose;

  // Fond : dégradé et anneaux du terrier.
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, hex(0x1d1433));
  bg.addColorStop(1, hex(COLORS.bg));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.lineWidth = 3;
  for (let i = 1; i <= 7; i++) {
    g.strokeStyle = hex(COLORS.accent, 0.12 - i * 0.012);
    g.beginPath();
    g.arc(W / 2, 520, 120 * i, 0, Math.PI * 2);
    g.stroke();
  }

  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = hex(COLORS.text);
  g.font = `700 64px ${FONT}`;
  g.fillText('🐇 RABBIT HOLE', W / 2, 150);
  g.fillStyle = hex(COLORS.muted);
  g.font = `500 34px ${FONT}`;
  g.fillText(input.labels.tagline, W / 2, 205);

  g.fillStyle = hex(tone);
  g.font = `800 150px ${FONT}`;
  g.fillText(fit(g, input.labels.outcome.toUpperCase(), W - 80), W / 2, 420);
  g.fillStyle = hex(COLORS.text, 0.85);
  g.font = `600 40px ${FONT}`;
  g.fillText(fit(g, [input.labels.reason, input.labels.turns].join(' · '), W - 120), W / 2, 490);

  // Les deux Leaders face à face.
  // Sans Personnages en jeu, les Leaders descendent pour équilibrer l'image.
  const shown = input.board.slice(0, 4);
  const cw = 390;
  const ch = 640;
  const top = shown.length ? 580 : 740;
  // Légende « Moi » au-dessus du nom du joueur (sauf sans compte, où le nom est déjà « Moi »).
  leaderCard(g, input.me, 80, top, cw, ch, input.nameOf, input.me.name === input.labels.you ? '' : input.labels.you, won);
  leaderCard(g, input.opponent, W - 80 - cw, top, cw, ch, input.nameOf, '', !won && !draw);
  g.fillStyle = hex(COLORS.accent);
  g.font = `900 72px ${FONT}`;
  g.fillText('VS', W / 2, top + ch / 2 + 24);

  // Mes Personnages encore en jeu.
  let y = top + ch + 100;
  if (shown.length) {
    g.textAlign = 'center';
    g.fillStyle = hex(COLORS.muted);
    g.font = `600 30px ${FONT}`;
    g.fillText(input.labels.board.toUpperCase(), W / 2, y);
    y += 80;
    for (const c of shown) {
      const color = c.category ? CATEGORY_STYLE[c.category].color : COLORS.accent;
      roundRect(g, 120, y - 52, W - 240, 76, 20);
      g.fillStyle = hex(color, 0.22);
      g.fill();
      g.textAlign = 'left';
      g.fillStyle = hex(COLORS.text);
      g.font = `600 38px ${FONT}`;
      g.fillText(fit(g, c.name, W - 460), 150, y);
      g.textAlign = 'right';
      g.fillStyle = hex(COLORS.power);
      g.font = `800 40px ${FONT}`;
      g.fillText(`⚡${c.power}`, W - 150, y);
      y += 96;
    }
  }

  g.textAlign = 'center';
  g.fillStyle = hex(COLORS.muted);
  g.font = `500 32px ${FONT}`;
  g.fillText([input.labels.mode, input.labels.date].filter(Boolean).join(' · '), W / 2, H - 120);
  g.fillStyle = hex(COLORS.accent);
  g.font = `700 36px ${FONT}`;
  g.fillText('#RabbitHole', W / 2, H - 70);
}

/** Image PNG de fin de partie. */
export async function renderEndImage(input: EndImageInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = END_IMAGE_SIZE.width;
  canvas.height = END_IMAGE_SIZE.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('canvas indisponible');
  await document.fonts?.ready;
  drawEndImage(g, input);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}

/** Partage natif du fichier quand l'appareil le permet ; sinon `false` (l'appelant propose le téléchargement). */
export async function shareImage(blob: Blob, text: string): Promise<boolean> {
  const file = new File([blob], 'rabbit-hole.png', { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], text });
  } catch {
    // Partage annulé par le joueur : rien à faire.
  }
  return true;
}
