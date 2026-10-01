import { KEYWORD_NAMES, type MatchContext } from '@rabbithole/engine';
import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { loc, locale } from '../i18n';
import { CATEGORY_STYLE, COLORS, FONT, RARITY_STYLE, shade } from './theme';

export type CardMode = 'board' | 'hand';

export const CARD_SIZE: Record<CardMode, { w: number; h: number }> = {
  board: { w: 104, h: 136 },
  hand: { w: 128, h: 176 },
};

export interface CardFace {
  defId: string | null;
  power: number | null;
  cost?: number;
  clickbait?: boolean;
  trending?: boolean;
}

const text = (value: string, style: TextStyleOptions) =>
  new Text({ text: value, style: { fontFamily: FONT, fill: COLORS.text, ...style }, resolution: 2 });

/** Carte affichée. Position = centre de la carte (pivot centré : retournement et zoom simples). */
export class CardSprite extends Container {
  face: CardFace = { defId: null, power: null };
  mode: CardMode;
  staged = false;
  selected = false;
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
    this.applySize();
  }

  get w(): number {
    return CARD_SIZE[this.mode].w;
  }

  get h(): number {
    return CARD_SIZE[this.mode].h;
  }

  private applySize(): void {
    this.pivot.set(this.w / 2, this.h / 2);
  }

  setMode(mode: CardMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applySize();
    this.redraw();
  }

  setFace(face: CardFace): void {
    const same =
      face.defId === this.face.defId &&
      face.power === this.face.power &&
      face.cost === this.face.cost &&
      !!face.clickbait === !!this.face.clickbait &&
      !!face.trending === !!this.face.trending;
    this.face = { ...face };
    if (!same || this.body.children.length === 0) this.redraw();
  }

  setPower(power: number): void {
    if (this.face.power === power) return;
    this.face = { ...this.face, power };
    this.drawPower();
  }

  setStaged(staged: boolean): void {
    this.staged = staged;
    this.drawOverlay();
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.drawOverlay();
  }

  redraw(): void {
    for (const child of this.body.removeChildren()) child.destroy({ children: true });
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
    const label = text('RH', { fontSize: this.mode === 'hand' ? 22 : 18, fontWeight: '700', fill: 0xffffff });
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
    // Bandeau de catégorie (deux couleurs pour les cartes multi-catégories).
    const second = def.categories[1] ? CATEGORY_STYLE[def.categories[1]] : null;
    bg.rect(6, 8, second ? (w - 12) / 2 : w - 12, 5).fill(cat.color);
    if (second) bg.rect(w / 2, 8, (w - 12) / 2, 5).fill(second.color);
    this.body.addChild(bg);

    // Grand symbole de catégorie en filigrane.
    const watermark = text(cat.glyph, { fontSize: h * 0.5, fill: cat.color, fontWeight: '700' });
    watermark.anchor.set(0.5);
    watermark.alpha = 0.16;
    watermark.position.set(w / 2, h * 0.58);
    this.body.addChild(watermark);

    const name = text(loc(def.name), {
      fontSize: hand ? 16 : 14,
      fontWeight: '700',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: w - 16,
      lineHeight: hand ? 18 : 16,
    });
    name.anchor.set(0.5);
    name.position.set(w / 2, h * (hand ? 0.36 : 0.4));
    this.body.addChild(name);

    if (hand && def.keywords.length > 0) {
      const kw = text(def.keywords.map((k) => KEYWORD_NAMES[k]?.[locale] ?? k).join(' · '), {
        fontSize: 11,
        fill: cat.color,
        fontWeight: '700',
      });
      kw.anchor.set(0.5);
      kw.position.set(w / 2, h * 0.62);
      this.body.addChild(kw);
    }
    if (def.effects.length > 0) {
      const fx = text('✦', { fontSize: hand ? 14 : 12, fill: COLORS.muted });
      fx.anchor.set(0.5);
      fx.position.set(16, h - 16);
      this.body.addChild(fx);
    }

    // Cadre de rareté : nombre de traits + ornements.
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

    if (hand && this.face.cost !== undefined) {
      const cost = new Graphics().circle(18, 20, 15).fill(COLORS.mana).stroke({ width: 2, color: 0x0d2a40 });
      const value = text(String(this.face.cost), { fontSize: 18, fontWeight: '700', fill: 0x06131f });
      value.anchor.set(0.5);
      value.position.set(18, 20);
      this.body.addChild(cost, value);
    }

    if (this.face.trending) {
      const trend = text('🔥', { fontSize: hand ? 16 : 14 });
      trend.anchor.set(0.5);
      trend.position.set(w - 16, 22);
      this.body.addChild(trend);
    }

    this.powerBadge = new Container();
    this.body.addChild(this.powerBadge);
    this.drawPower();
  }

  private drawPower(): void {
    for (const child of this.powerBadge.removeChildren()) child.destroy();
    if (this.face.defId === null || this.face.power === null) return;
    const hand = this.mode === 'hand';
    const r = hand ? 17 : 16;
    const x = this.w - r - 4;
    const y = this.h - r - 4;
    const fill = this.face.clickbait ? COLORS.accent : COLORS.power;
    const g = new Graphics().circle(x, y, r).fill(fill).stroke({ width: 2, color: 0x2a1a05 });
    const value = text(String(this.face.power), { fontSize: hand ? 20 : 19, fontWeight: '700', fill: COLORS.powerText });
    value.anchor.set(0.5);
    value.position.set(x, y);
    this.powerBadge.addChild(g, value);
  }

  private drawOverlay(): void {
    this.overlay.clear();
    if (this.selected) {
      this.overlay.roundRect(-4, -4, this.w + 8, this.h + 8, 14).stroke({ width: 3, color: COLORS.accent });
    }
    this.body.alpha = this.staged ? 0.72 : 1;
    if (this.staged) {
      this.overlay.roundRect(-3, -3, this.w + 6, this.h + 6, 12).stroke({ width: 2, color: COLORS.mana, alpha: 0.9 });
    }
  }
}
