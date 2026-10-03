import { KEYWORD_NAMES, type MatchContext } from '@rabbithole/engine';
import { ColorMatrixFilter, Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { loc, locale, t } from '../i18n';
import { CATEGORY_STYLE, COLORS, FONT, RARITY_STYLE, shade } from './theme';

export type CardMode = 'board' | 'hand';

export const CARD_SIZE: Record<CardMode, { w: number; h: number }> = {
  board: { w: 108, h: 148 },
  hand: { w: 118, h: 164 },
};

export type Highlight = 'playable' | 'ready' | 'target' | null;

export interface CardFace {
  /** `null` = dos de carte. */
  defId: string | null;
  power: number | null;
  cost?: number;
  counter?: number;
  buzz?: number;
  cancelled?: boolean;
  trending?: boolean;
  /** Variante cosmétique (holo, gold, glitch, negative, vhs, pixel) : même carte, autre apparence. */
  variant?: string | null;
}

const text = (value: string, style: TextStyleOptions) =>
  new Text({ text: value, style: { fontFamily: FONT, fill: COLORS.text, ...style }, resolution: 2 });

const HIGHLIGHT_COLOR: Record<Exclude<Highlight, null>, number> = {
  playable: COLORS.win,
  ready: COLORS.mana,
  target: COLORS.lose,
};

/** Carte affichée. Position = centre de la carte (pivot centré : rotation « épuisé », zoom, retournement). */
export class CardSprite extends Container {
  face: CardFace = { defId: null, power: null };
  mode: CardMode;
  selected = false;
  highlight: Highlight = null;
  private readonly body = new Container();
  private readonly overlay = new Graphics();
  private powerBadge = new Container();

  constructor(
    private readonly ctx: MatchContext,
    readonly cardUid: string,
    mode: CardMode,
  ) {
    super();
    this.mode = mode;
    this.addChild(this.body, this.overlay);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.pivot.set(this.w / 2, this.h / 2);
  }

  get w(): number {
    return CARD_SIZE[this.mode].w;
  }

  get h(): number {
    return CARD_SIZE[this.mode].h;
  }

  setMode(mode: CardMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.pivot.set(this.w / 2, this.h / 2);
    this.redraw();
  }

  setFace(face: CardFace): void {
    const same = JSON.stringify(face) === JSON.stringify(this.face);
    this.face = { ...face };
    if (!same || this.body.children.length === 0) this.redraw();
  }

  setPower(power: number): void {
    if (this.face.power === power) return;
    this.face = { ...this.face, power };
    this.drawPower();
  }

  setState(selected: boolean, highlight: Highlight): void {
    if (selected === this.selected && highlight === this.highlight) return;
    this.selected = selected;
    this.highlight = highlight;
    this.drawOverlay();
  }

  redraw(): void {
    for (const child of this.body.removeChildren()) child.destroy({ children: true });
    this.body.filters = [];
    if (this.face.defId === null) this.drawBack();
    else this.drawFront(this.face.defId);
    this.drawOverlay();
  }

  private drawBack(): void {
    const { w, h } = this;
    const g = new Graphics().roundRect(0, 0, w, h, 10).fill(COLORS.cardBack).stroke({ width: 2, color: 0x4a3a78 });
    // Motif « terrier » : spirale de cercles concentriques.
    for (let i = 0; i < 6; i++) {
      g.circle(w / 2 + i * 1.5, h / 2 - i * 1.2, (w / 2.6) * (1 - i / 6)).stroke({ width: 2, color: COLORS.accent, alpha: 0.12 + i * 0.1 });
    }
    const label = text('RH', { fontSize: 20, fontWeight: '700', fill: 0xffffff });
    label.anchor.set(0.5);
    label.position.set(w / 2, h / 2);
    this.body.addChild(g, label);
  }

  private drawFront(defId: string): void {
    const def = this.ctx.cards[defId];
    if (!def) return;
    const { w, h } = this;
    const hand = this.mode === 'hand';
    const cat = CATEGORY_STYLE[def.categories[0] ?? 'internet'];
    const rarity = RARITY_STYLE[def.rarity];

    const bg = new Graphics().roundRect(0, 0, w, h, rarity.radius).fill(shade(cat.color, 0.26));
    const second = def.categories[1] ? CATEGORY_STYLE[def.categories[1]] : null;
    bg.rect(6, 8, second ? (w - 12) / 2 : w - 12, 5).fill(cat.color);
    if (second) bg.rect(w / 2, 8, (w - 12) / 2, 5).fill(second.color);
    this.body.addChild(bg);

    const watermark = text(cat.glyph, { fontSize: h * 0.5, fill: cat.color, fontWeight: '700' });
    watermark.anchor.set(0.5);
    watermark.alpha = 0.16;
    watermark.position.set(w / 2, h * 0.58);
    this.body.addChild(watermark);

    if (def.type !== 'character') {
      const label = text(def.type === 'leader' ? t('leader').toUpperCase() : t('event').toUpperCase(), {
        fontSize: 12,
        fontWeight: '700',
        fill: def.type === 'leader' ? COLORS.power : COLORS.accent,
        letterSpacing: 1.5,
      });
      label.anchor.set(0.5);
      // En bas : le haut est occupé par le coût ; un Leader a sa puissance en bas à droite.
      label.position.set(def.type === 'event' ? w / 2 : w / 2 - 14, h - 16);
      this.body.addChild(label);
    }

    const name = text(loc(def.name), {
      fontSize: hand ? 18 : 17,
      fontWeight: '700',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: w - 12,
      lineHeight: hand ? 20 : 19,
    });
    // Un mot trop long pour la largeur (ex. « L'Influenceuse ») : on réduit la police.
    while (name.width > w - 10 && Number(name.style.fontSize) > 11) name.style.fontSize = Number(name.style.fontSize) - 1;
    name.anchor.set(0.5);
    name.position.set(w / 2, h * 0.38);
    this.body.addChild(name);

    const tags = def.keywords.map((k) => KEYWORD_NAMES[k][locale]);
    if (def.effects.length > 0) tags.push('✦');
    if (tags.length) {
      const kw = text(tags.join(' · '), { fontSize: 13, fill: cat.color, fontWeight: '700', align: 'center', wordWrap: true, wordWrapWidth: w - 10 });
      kw.anchor.set(0.5);
      kw.position.set(w / 2, h * 0.62);
      this.body.addChild(kw);
    }

    // Cadre de rareté : nombre de traits + ornements (forme ET couleur, pour le daltonisme).
    const frame = new Graphics();
    for (let i = 0; i < rarity.lines; i++) {
      const inset = 1 + i * 3.5;
      frame.roundRect(inset, inset, w - inset * 2, h - inset * 2, Math.max(2, rarity.radius - inset)).stroke({ width: 2, color: rarity.color });
    }
    const corners: [number, number][] = [
      [8, 8],
      [w - 8, 8],
      [8, h - 8],
      [w - 8, h - 8],
    ];
    if (rarity.ornament === 'dots') for (const [x, y] of corners) frame.circle(x, y, 3).fill(rarity.color);
    if (rarity.ornament === 'diamonds' || rarity.ornament === 'crown') {
      for (const [x, y] of corners) frame.poly([x, y - 5, x + 5, y, x, y + 5, x - 5, y]).fill(rarity.color);
    }
    if (rarity.ornament === 'crown') frame.star(w / 2, 2, 5, 9, 4).fill(rarity.color);
    this.body.addChild(frame);
    if (this.face.variant) this.drawVariant(this.face.variant, rarity.radius);

    if (hand && def.type !== 'leader' && this.face.cost !== undefined) {
      const cost = new Graphics().circle(19, 21, 17).fill(COLORS.mana).stroke({ width: 2, color: 0x0d2a40 });
      const value = text(String(this.face.cost), { fontSize: 21, fontWeight: '700', fill: 0x06131f });
      value.anchor.set(0.5);
      value.position.set(19, 21);
      this.body.addChild(cost, value);
    }

    // Valeur de Contre (main uniquement) : bouclier à gauche.
    if (hand && (this.face.counter ?? 0) > 0) {
      const y = h - 22;
      const shield = new Graphics().roundRect(4, y - 14, 38, 28, 9).fill(0x2a1f44).stroke({ width: 2, color: COLORS.win });
      const value = text(`+${this.face.counter}`, { fontSize: 17, fontWeight: '700', fill: COLORS.win });
      value.anchor.set(0.5);
      value.position.set(23, y);
      this.body.addChild(shield, value);
    }

    if ((this.face.buzz ?? 0) > 0) {
      const badge = new Graphics().roundRect(w - 48, 14, 42, 26, 13).fill(COLORS.mana);
      const value = text(`⚡${this.face.buzz}`, { fontSize: 16, fontWeight: '700', fill: 0x06131f });
      value.anchor.set(0.5);
      value.position.set(w - 27, 27);
      this.body.addChild(badge, value);
    } else if (this.face.trending) {
      const trend = text('🔥', { fontSize: 15 });
      trend.anchor.set(0.5);
      trend.position.set(w - 16, 24);
      this.body.addChild(trend);
    }

    if (this.face.cancelled) {
      const veil = new Graphics().roundRect(0, 0, w, h, rarity.radius).fill({ color: 0x000000, alpha: 0.45 });
      const mark = text('✕', { fontSize: 28, fontWeight: '700', fill: COLORS.lose });
      mark.anchor.set(0.5);
      mark.position.set(w / 2, h * 0.62);
      this.body.addChild(veil, mark);
    }

    this.powerBadge = new Container();
    this.body.addChild(this.powerBadge);
    this.drawPower();
  }

  /** Variantes cosmétiques (section 6.6) : effets dessinés par-dessus la carte, sans toucher à ses valeurs. */
  private drawVariant(variant: string, radius: number): void {
    const { w, h } = this;
    const fx = new Graphics();
    switch (variant) {
      case 'gold':
        fx.roundRect(0, 0, w, h, radius).fill({ color: 0xffc94a, alpha: 0.16 });
        fx.roundRect(1, 1, w - 2, h - 2, radius).stroke({ width: 4, color: 0xffc94a });
        fx.poly([w * 0.35, 0, w * 0.55, 0, w * 0.15, h, -w * 0.05, h]).fill({ color: 0xfff0be, alpha: 0.2 });
        break;
      case 'holo': {
        const colors = [0xff4fd8, 0x4fb8ff, 0x6dff9e, 0xffe34f];
        colors.forEach((color, i) => {
          const x = (i / colors.length) * w * 1.6 - w * 0.3;
          fx.poly([x, 0, x + w * 0.25, 0, x + w * 0.05, h, x - w * 0.2, h]).fill({ color, alpha: 0.16 });
        });
        fx.blendMode = 'add';
        break;
      }
      case 'glitch':
        for (const [y, color] of [
          [0.18, 0x2be0ff],
          [0.41, 0xff2b6d],
          [0.57, 0x2be0ff],
          [0.83, 0xff2b6d],
        ] as const) {
          fx.rect(y * 12, h * y, w, 3).fill({ color, alpha: 0.45 });
        }
        break;
      case 'negative': {
        const invert = new ColorMatrixFilter();
        invert.negative(false);
        this.body.filters = [invert];
        return;
      }
      case 'vhs': {
        const tint = new ColorMatrixFilter();
        tint.sepia(false);
        tint.alpha = 0.35;
        this.body.filters = [tint];
        for (let y = 0; y < h; y += 3) fx.rect(0, y, w, 1).fill({ color: 0x000000, alpha: 0.22 });
        break;
      }
      case 'pixel':
        for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 6 : 0; x < w; x += 12) fx.rect(x, y, 6, 6).fill({ color: 0xffffff, alpha: 0.06 });
        fx.roundRect(1, 1, w - 2, h - 2, 0).stroke({ width: 3, color: 0xffffff, alpha: 0.5 });
        break;
      default:
        return;
    }
    // Les effets restent dans la forme de la carte.
    const mask = new Graphics().roundRect(0, 0, w, h, radius).fill(0xffffff);
    fx.mask = mask;
    this.body.addChild(mask, fx);
  }

  private drawPower(): void {
    for (const child of this.powerBadge.removeChildren()) child.destroy();
    const def = this.face.defId ? this.ctx.cards[this.face.defId] : null;
    if (!def || def.type === 'event' || this.face.power === null) return;
    const r = 20;
    const x = this.w - r - 3;
    const y = this.h - r - 3;
    const boosted = this.face.power > def.power;
    const g = new Graphics()
      .circle(x, y, r)
      .fill(boosted ? COLORS.win : COLORS.power)
      .stroke({ width: 2, color: 0x2a1a05 });
    const value = text(String(this.face.power), { fontSize: 23, fontWeight: '700', fill: COLORS.powerText });
    value.anchor.set(0.5);
    value.position.set(x, y);
    this.powerBadge.addChild(g, value);
  }

  private drawOverlay(): void {
    this.overlay.clear();
    if (this.highlight) {
      this.overlay.roundRect(-3, -3, this.w + 6, this.h + 6, 12).stroke({ width: 3, color: HIGHLIGHT_COLOR[this.highlight], alpha: 0.95 });
    }
    if (this.selected) {
      this.overlay.roundRect(-6, -6, this.w + 12, this.h + 12, 14).stroke({ width: 3, color: COLORS.accent });
    }
  }
}
