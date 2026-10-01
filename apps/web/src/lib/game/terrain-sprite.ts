import type { MatchContext } from '@rabbithole/engine';
import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { loc, t } from '../i18n';
import { CATEGORY_STYLE, COLORS, FONT } from './theme';

export const TERRAIN_SIZE = { w: 226, h: 150 };

const text = (value: string, style: TextStyleOptions) =>
  new Text({ text: value, style: { fontFamily: FONT, fill: COLORS.text, ...style }, resolution: 2 });

/** Tuile de terrain : nom, effet, puissance de chaque camp (moi en bas, adversaire en haut). */
export class TerrainSprite extends Container {
  private readonly content = new Container();
  private defId: string | null = null;
  private powers: [number, number] = [0, 0];

  constructor(
    private readonly ctx: MatchContext,
    readonly index: number,
    private readonly revealTurn: number,
  ) {
    super();
    this.pivot.set(TERRAIN_SIZE.w / 2, TERRAIN_SIZE.h / 2);
    this.addChild(this.content);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.redraw();
  }

  get revealed(): boolean {
    return this.defId !== null;
  }

  /** `powers` = [moi, adversaire]. */
  update(defId: string | null, powers: [number, number]): void {
    if (defId === this.defId && powers[0] === this.powers[0] && powers[1] === this.powers[1]) return;
    this.defId = defId;
    this.powers = powers;
    this.redraw();
  }

  private redraw(): void {
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    const { w, h } = TERRAIN_SIZE;
    const def = this.defId ? this.ctx.terrains[this.defId] : null;
    const tint = def?.favoredCategory ? CATEGORY_STYLE[def.favoredCategory].color : COLORS.accent;

    const bg = new Graphics()
      .roundRect(0, 0, w, h, 18)
      .fill(def ? COLORS.terrain : COLORS.terrainHidden)
      .stroke({ width: 2, color: def ? tint : COLORS.zoneLine, alpha: def ? 0.9 : 0.6 });
    this.content.addChild(bg);

    if (!def) {
      const q = text('?', { fontSize: 44, fontWeight: '700', fill: COLORS.muted });
      q.anchor.set(0.5);
      q.position.set(w / 2, h / 2 - 8);
      const when = text(t('revealed_on_turn', { n: this.revealTurn }), { fontSize: 12, fill: COLORS.muted });
      when.anchor.set(0.5);
      when.position.set(w / 2, h / 2 + 30);
      this.content.addChild(q, when);
    } else {
      const name = text(loc(def.name), { fontSize: 18, fontWeight: '700', align: 'center', wordWrap: true, wordWrapWidth: w - 24 });
      name.anchor.set(0.5);
      name.position.set(w / 2, 44);
      const desc = text(loc(def.description), {
        fontSize: 12,
        fill: COLORS.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: w - 28,
        lineHeight: 15,
      });
      desc.anchor.set(0.5, 0);
      desc.position.set(w / 2, 64);
      this.content.addChild(name, desc);
    }

    // Puissances : adversaire en haut, moi en bas. Vert = mène, rouge = derrière.
    const [mine, theirs] = this.powers;
    const color = (a: number, b: number) => (a > b ? COLORS.win : a < b ? COLORS.lose : COLORS.muted);
    this.badge(w / 2, 0, theirs, color(theirs, mine));
    this.badge(w / 2, h, mine, color(mine, theirs));
  }

  private badge(x: number, y: number, value: number, color: number): void {
    const g = new Graphics().roundRect(x - 24, y - 15, 48, 30, 15).fill(COLORS.bg).stroke({ width: 2, color });
    const v = text(String(value), { fontSize: 17, fontWeight: '700', fill: color });
    v.anchor.set(0.5);
    v.position.set(x, y);
    this.content.addChild(g, v);
  }
}
