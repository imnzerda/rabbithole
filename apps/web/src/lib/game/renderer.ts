import { type MatchContext, type MatchEvent, type Play, type PlayerView, type VisibleCard } from '@rabbithole/engine';
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { t } from '../i18n';
import { CardSprite, type CardFace } from './card-sprite';
import { TerrainSprite, TERRAIN_SIZE } from './terrain-sprite';
import { COLORS, FONT } from './theme';
import { ease, Tweener } from './tween';

// ---------------------------------------------------------------------------
// Disposition logique (portrait). Le tout est mis à l'échelle de l'écran.
// ---------------------------------------------------------------------------

export const LOGICAL = { w: 720, h: 975 };
const COL_X = (i: number) => 10 + i * 237;
const COL_W = 226;
const OPP_ZONE = { y: 4, h: 290 };
const TERRAIN_Y = 304;
const MY_ZONE = { y: 466, h: 290 };
const HAND_Y = 868;

/** Côté visuel : 0 = moi (en bas), 1 = adversaire (en haut). */
type VisualSide = 0 | 1;

function slotBase(terrain: number, side: VisualSide, index: number): { x: number; y: number } {
  const c = index % 2;
  const r = Math.floor(index / 2);
  const x = COL_X(terrain) + 58 + c * 110;
  const y = side === 0 ? MY_ZONE.y + 74 + r * 142 : OPP_ZONE.y + OPP_ZONE.h - 74 - r * 142;
  return { x, y };
}

export interface RendererCallbacks {
  /** Le joueur dépose une carte de sa main sur un terrain. Renvoie `false` si refusé. */
  onDrop(uid: string, terrain: number): boolean;
  onUnstage(uid: string): void;
  onInspectCard(defId: string, power: number | null): void;
  onInspectTerrain(terrain: number): void;
}

export interface RenderOptions {
  staged: Play[];
  interactive: boolean;
  /** Pour surligner les terrains où la carte tirée peut être posée. */
  canDrop: (uid: string, terrain: number) => boolean;
}

interface Press {
  sprite: CardSprite;
  origin: 'hand' | 'staged' | 'board';
  startX: number;
  startY: number;
  dragging: boolean;
  longPressed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export class GameRenderer {
  readonly app = new Application();
  private tween!: Tweener;
  private readonly root = new Container();
  private readonly zonesLayer = new Container();
  private readonly terrainsLayer = new Container();
  private readonly boardLayer = new Container();
  private readonly handLayer = new Container();
  private readonly dragLayer = new Container();
  private readonly fxLayer = new Container();

  private readonly sprites = new Map<string, CardSprite>();
  private readonly tiles: TerrainSprite[] = [];
  private readonly zones: Graphics[] = [];
  /** Modèle d'emplacements pendant l'animation : [terrain][côté visuel] = uids. */
  private slots: string[][][] = [];
  private handOrder: string[] = [];
  private stagedUids = new Set<string>();

  private view: PlayerView | null = null;
  private options: RenderOptions = { staged: [], interactive: false, canDrop: () => false };
  private selected: string | null = null;
  private press: Press | null = null;
  private destroyed = false;
  /** Sur un écran plus haut que la disposition logique : le plateau descend un peu, la main se colle en bas. */
  private oy = 0;
  private handY = HAND_Y;

  constructor(
    private readonly ctx: MatchContext,
    private readonly callbacks: RendererCallbacks,
  ) {}

  private slotPos(terrain: number, side: VisualSide, index: number): { x: number; y: number } {
    const p = slotBase(terrain, side, index);
    return { x: p.x, y: p.y + this.oy };
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: COLORS.bg,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) return;
    host.appendChild(this.app.canvas);
    this.tween = new Tweener(this.app.ticker);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.tween.speed = 0.05;

    this.root.addChild(this.zonesLayer, this.terrainsLayer, this.boardLayer, this.handLayer, this.dragLayer, this.fxLayer);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('globalpointermove', (e) => this.onMove(e));
    this.app.stage.on('pointerup', (e) => this.onUp(e));
    this.app.stage.on('pointerupoutside', (e) => this.onUp(e));

    for (let i = 0; i < 3; i++) {
      for (const side of [0, 1] as VisualSide[]) {
        const zone = new Graphics();
        zone.eventMode = side === 0 ? 'static' : 'none';
        if (side === 0) zone.on('pointertap', () => this.onZoneTap(i));
        this.zones[i * 2 + side] = zone;
        this.zonesLayer.addChild(zone);
      }
      const tile = new TerrainSprite(this.ctx, i, this.ctx.rules.terrainRevealTurns[i] ?? i + 1);
      tile.on('pointertap', () => this.callbacks.onInspectTerrain(i));
      this.tiles.push(tile);
      this.terrainsLayer.addChild(tile);
    }
    this.drawZones(null);
    this.app.renderer.on('resize', () => this.fit());
    this.fit();
  }

  private fit(): void {
    const { width, height } = this.app.screen;
    const scale = Math.min(width / LOGICAL.w, height / LOGICAL.h);
    const extra = Math.max(0, height / scale - LOGICAL.h);
    this.oy = Math.round(extra * 0.45);
    this.handY = HAND_Y + Math.round(extra * 0.9);
    this.root.scale.set(scale);
    this.root.position.set((width - LOGICAL.w * scale) / 2, 0);
    this.app.stage.hitArea = this.app.screen;
    this.tiles.forEach((tile, i) => tile.position.set(COL_X(i) + COL_W / 2, TERRAIN_Y + TERRAIN_SIZE.h / 2 + this.oy));
    this.drawZones(null);
    this.refresh();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.press) clearTimeout(this.press.timer);
    try {
      this.app.destroy({ removeView: true }, { children: true });
    } catch {
      // Application jamais initialisée (démontage pendant l'init).
    }
  }

  // -------------------------------------------------------------------------
  // Synchronisation avec la vue
  // -------------------------------------------------------------------------

  private drawZones(dragUid: string | null): void {
    for (let i = 0; i < 3; i++) {
      for (const side of [0, 1] as VisualSide[]) {
        const zone = this.zones[i * 2 + side];
        if (!zone) continue;
        const area = side === 0 ? MY_ZONE : OPP_ZONE;
        const droppable = side === 0 && dragUid !== null && this.options.canDrop(dragUid, i);
        zone
          .clear()
          .roundRect(COL_X(i), area.y + this.oy, COL_W, area.h, 16)
          .fill(droppable ? COLORS.zoneDropActive : COLORS.zone)
          .stroke({ width: droppable ? 3 : 1, color: droppable ? COLORS.mana : COLORS.zoneLine });
      }
    }
  }

  private sprite(uid: string, mode: 'board' | 'hand'): CardSprite {
    let s = this.sprites.get(uid);
    if (!s) {
      s = new CardSprite(this.ctx, uid, mode);
      s.on('pointerdown', (e) => this.onCardDown(s!, e));
      this.sprites.set(uid, s);
    }
    return s;
  }

  private faceOf(card: VisibleCard): CardFace {
    return { defId: card.defId, power: card.power, cost: card.cost, clickbait: card.clickbait, trending: card.trending };
  }

  /** Met l'affichage en conformité avec la vue (qui fait foi) et les poses en attente. */
  render(view: PlayerView, options: RenderOptions): void {
    if (this.destroyed || !this.tween) return;
    this.view = view;
    this.options = options;
    const me = view.you;
    const opp = me === 0 ? 1 : 0;
    this.stagedUids = new Set(options.staged.map((p) => p.uid));
    if (this.selected && !view.hand.some((c) => c.uid === this.selected && !this.stagedUids.has(c.uid))) this.selected = null;

    view.terrains.forEach((tv, i) => this.tiles[i]?.update(tv.defId, [tv.power[me], tv.power[opp]]));

    const keep = new Set<string>();
    this.slots = view.terrains.map(() => [[], []]);

    view.terrains.forEach((tv, ti) => {
      for (const [visual, real] of [
        [0, me],
        [1, opp],
      ] as const) {
        tv.cards[real].forEach((card) => {
          this.placeBoard(card.uid, this.faceOf(card), ti, visual, false);
          keep.add(card.uid);
        });
      }
    });

    for (const play of options.staged) {
      const card = view.hand.find((c) => c.uid === play.uid);
      if (!card) continue;
      this.placeBoard(card.uid, { defId: card.defId, power: card.power }, play.terrain, 0, true);
      keep.add(card.uid);
    }

    this.handOrder = view.hand.filter((c) => !this.stagedUids.has(c.uid)).map((c) => c.uid);
    for (const card of view.hand) {
      if (this.stagedUids.has(card.uid)) continue;
      const s = this.sprite(card.uid, 'hand');
      if (!s.parent) s.position.set(LOGICAL.w + 80, this.handY);
      s.setMode('hand');
      s.setFace(this.faceOf(card));
      s.setStaged(false);
      keep.add(card.uid);
    }
    this.layoutHand();

    for (const [uid, s] of this.sprites) {
      if (keep.has(uid)) continue;
      this.sprites.delete(uid);
      void this.tween.to(s, { alpha: 0 }, 200).then(() => s.destroy({ children: true }));
    }
    this.drawZones(null);
  }

  private placeBoard(uid: string, face: CardFace, terrain: number, side: VisualSide, staged: boolean): void {
    const s = this.sprite(uid, 'board');
    const index = this.slots[terrain]![side]!.length;
    this.slots[terrain]![side]!.push(uid);
    const pos = this.slotPos(terrain, side, index);
    if (!s.parent) s.position.set(pos.x, side === 1 ? -100 : pos.y);
    s.setMode('board');
    s.setFace(face);
    s.setStaged(staged);
    s.setSelected(false);
    s.alpha = 1;
    this.boardLayer.addChild(s);
    void this.tween.to(s.position, pos, 260);
    void this.tween.to(s.scale, { x: 1, y: 1 }, 200);
  }

  private layoutHand(): void {
    const n = this.handOrder.length;
    const spacing = n > 1 ? Math.min(136, (LOGICAL.w - 20 - 128) / (n - 1)) : 0;
    const start = LOGICAL.w / 2 - (spacing * (n - 1)) / 2;
    this.handOrder.forEach((uid, i) => {
      const s = this.sprites.get(uid);
      if (!s) return;
      const selected = uid === this.selected;
      s.setSelected(selected);
      this.handLayer.addChild(s);
      void this.tween.to(s.position, { x: start + i * spacing, y: this.handY - (selected ? 22 : 0) }, 220);
      void this.tween.to(s.scale, { x: 1, y: 1 }, 200);
    });
  }

  /** Position à l'écran (pixels CSS) d'une carte de la main : utilisé par les tests E2E. */
  handCardScreenPosition(index: number): { x: number; y: number } | null {
    const s = this.sprites.get(this.handOrder[index] ?? '');
    if (!s) return null;
    const p = s.getGlobalPosition();
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  private refresh(): void {
    if (this.view) this.render(this.view, this.options);
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  private local(e: FederatedPointerEvent): { x: number; y: number } {
    return this.root.toLocal(e.global);
  }

  private zoneAt(x: number, y: number): number | null {
    y -= this.oy;
    if (y < MY_ZONE.y - 20 || y > MY_ZONE.y + MY_ZONE.h + 20) return null;
    for (let i = 0; i < 3; i++) if (x >= COL_X(i) && x <= COL_X(i) + COL_W) return i;
    return null;
  }

  private onCardDown(sprite: CardSprite, e: FederatedPointerEvent): void {
    e.stopPropagation();
    if (this.press) clearTimeout(this.press.timer);
    const origin = this.stagedUids.has(sprite.cardUid) ? 'staged' : this.handOrder.includes(sprite.cardUid) ? 'hand' : 'board';
    const p = this.local(e);
    const press: Press = {
      sprite,
      origin,
      startX: p.x,
      startY: p.y,
      dragging: false,
      longPressed: false,
      timer: setTimeout(() => {
        if (this.press !== press || press.dragging || sprite.face.defId === null) return;
        press.longPressed = true;
        this.callbacks.onInspectCard(sprite.face.defId, sprite.face.power);
      }, 450),
    };
    this.press = press;
  }

  private onMove(e: FederatedPointerEvent): void {
    const press = this.press;
    if (!press || press.longPressed || press.origin !== 'hand' || !this.options.interactive) return;
    const p = this.local(e);
    if (!press.dragging) {
      if (Math.hypot(p.x - press.startX, p.y - press.startY) < 10) return;
      press.dragging = true;
      clearTimeout(press.timer);
      this.selected = null;
      press.sprite.setSelected(false);
      this.dragLayer.addChild(press.sprite);
      void this.tween.to(press.sprite.scale, { x: 1.06, y: 1.06 }, 120);
    }
    press.sprite.position.set(p.x, p.y - 30);
    const zone = this.zoneAt(p.x, p.y);
    this.drawZones(press.sprite.cardUid);
    if (zone !== null && this.options.canDrop(press.sprite.cardUid, zone)) {
      this.zones[zone * 2]?.roundRect(COL_X(zone), MY_ZONE.y + this.oy, COL_W, MY_ZONE.h, 16).stroke({ width: 4, color: COLORS.accent });
    }
  }

  private onUp(e: FederatedPointerEvent): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    clearTimeout(press.timer);
    if (press.longPressed) return;

    if (press.dragging) {
      const p = this.local(e);
      const zone = this.zoneAt(p.x, p.y);
      this.drawZones(null);
      if (zone === null || !this.callbacks.onDrop(press.sprite.cardUid, zone)) this.refresh();
      return;
    }

    const def = press.sprite.face.defId;
    if (press.origin === 'hand') {
      if (!this.options.interactive) {
        if (def) this.callbacks.onInspectCard(def, press.sprite.face.power);
        return;
      }
      this.selected = this.selected === press.sprite.cardUid ? null : press.sprite.cardUid;
      this.layoutHand();
    } else if (press.origin === 'staged') {
      if (this.options.interactive) this.callbacks.onUnstage(press.sprite.cardUid);
    } else if (def) {
      this.callbacks.onInspectCard(def, press.sprite.face.power);
    }
  }

  private onZoneTap(terrain: number): void {
    if (!this.selected || !this.options.interactive) return;
    const uid = this.selected;
    this.selected = null;
    if (!this.callbacks.onDrop(uid, terrain)) this.refresh();
  }

  // -------------------------------------------------------------------------
  // Animation des événements du moteur
  // -------------------------------------------------------------------------

  private find(uid: string): { terrain: number; side: VisualSide; index: number } | null {
    for (let t = 0; t < this.slots.length; t++) {
      for (const side of [0, 1] as VisualSide[]) {
        const index = this.slots[t]![side]!.indexOf(uid);
        if (index >= 0) return { terrain: t, side, index };
      }
    }
    return null;
  }

  private relayout(terrain: number, side: VisualSide): void {
    this.slots[terrain]![side]!.forEach((uid, i) => {
      const s = this.sprites.get(uid);
      if (s) void this.tween.to(s.position, this.slotPos(terrain, side, i), 260, ease.inOutCubic);
    });
  }

  private float(x: number, y: number, label: string, color: number, size = 26): void {
    const txt = new Text({
      text: label,
      style: { fontFamily: FONT, fontSize: size, fontWeight: '700', fill: color, stroke: { color: 0x000000, width: 4 } },
      resolution: 2,
    });
    txt.anchor.set(0.5);
    txt.position.set(x, y);
    this.fxLayer.addChild(txt);
    void this.tween.to(txt.position, { y: y - 46 }, 800);
    void this.tween.to(txt, { alpha: 0 }, 800, ease.linear).then(() => txt.destroy());
  }

  /** Grand bandeau au centre (tour, Hype). */
  async banner(label: string, color: number = COLORS.text): Promise<void> {
    if (!this.tween) return;
    const box = new Container();
    const txt = new Text({ text: label, style: { fontFamily: FONT, fontSize: 40, fontWeight: '700', fill: color }, resolution: 2 });
    txt.anchor.set(0.5);
    const bg = new Graphics().roundRect(-txt.width / 2 - 28, -36, txt.width + 56, 72, 36).fill({ color: 0x000000, alpha: 0.75 });
    box.addChild(bg, txt);
    box.position.set(LOGICAL.w / 2, TERRAIN_Y + TERRAIN_SIZE.h / 2 + this.oy);
    box.scale.set(0.6);
    box.alpha = 0;
    this.fxLayer.addChild(box);
    await Promise.all([this.tween.to(box.scale, { x: 1, y: 1 }, 260, ease.outBack), this.tween.to(box, { alpha: 1 }, 200)]);
    await this.tween.wait(650);
    await this.tween.to(box, { alpha: 0 }, 250);
    box.destroy({ children: true });
  }

  private async flip(s: CardSprite, face: CardFace): Promise<void> {
    await this.tween.to(s.scale, { x: 0 }, 110, ease.linear);
    s.setFace(face);
    s.setStaged(false);
    await this.tween.to(s.scale, { x: 1.12, y: 1.12 }, 130, ease.outCubic);
    await this.tween.to(s.scale, { x: 1, y: 1 }, 120);
  }

  /** Joue les événements d'une résolution, puis se cale sur la vue finale. */
  async animate(events: MatchEvent[], finalView: PlayerView, finalOptions: RenderOptions): Promise<void> {
    if (!this.view || this.destroyed) return;
    const me = this.view.you;
    const side = (player: number): VisualSide => (player === me ? 0 : 1);
    const k = this.ctx.rules.keywords;

    for (const e of events) {
      if (this.destroyed) return;
      switch (e.type) {
        case 'turn_started':
          if (e.turn > 1) await this.banner(e.turn === this.ctx.rules.turns ? t('final_turn_banner') : t('turn_banner', { n: e.turn }));
          break;
        case 'terrain_revealed': {
          const tile = this.tiles[e.terrain];
          if (!tile) break;
          await this.tween.to(tile.scale, { x: 0 }, 140, ease.linear);
          tile.update(e.defId, [0, 0]);
          await this.tween.to(tile.scale, { x: 1 }, 160);
          break;
        }
        case 'card_played': {
          if (side(e.player) === 0) break; // déjà affichée (pose en attente)
          const s = this.sprite(e.uid, 'board');
          s.setMode('board');
          s.setFace({ defId: null, power: null });
          const index = this.slots[e.terrain]![1]!.length;
          this.slots[e.terrain]![1]!.push(e.uid);
          const pos = this.slotPos(e.terrain, 1, index);
          s.position.set(pos.x, -120);
          this.boardLayer.addChild(s);
          await this.tween.to(s.position, pos, 220);
          break;
        }
        case 'card_revealed': {
          const s = this.sprites.get(e.uid);
          if (!s) break;
          await this.flip(s, { defId: e.defId, power: e.power, clickbait: false });
          await this.tween.wait(140);
          break;
        }
        case 'keyword_triggered': {
          const s = this.sprites.get(e.uid);
          if (!s?.parent) break;
          const label = e.keyword.toUpperCase();
          this.float(s.x, s.y - 50, label, COLORS.accent, 20);
          if (e.keyword === 'clickbait') s.setFace({ ...s.face, clickbait: true, power: (s.face.power ?? 0) + k.clickbait.bonus });
          await this.tween.wait(260);
          break;
        }
        case 'power_changed':
        case 'power_set': {
          const s = this.sprites.get(e.uid);
          if (!s?.parent || !this.find(e.uid)) break;
          const before = s.face.power ?? 0;
          s.setPower(e.power);
          const delta = e.type === 'power_changed' ? e.delta : e.power - before;
          if (delta !== 0) this.float(s.x, s.y - 10, delta > 0 ? `+${delta}` : `${delta}`, delta > 0 ? COLORS.win : COLORS.lose);
          await this.tween.wait(200);
          break;
        }
        case 'card_destroyed': {
          const at = this.find(e.uid);
          const s = this.sprites.get(e.uid);
          if (!at || !s) break;
          this.float(s.x, s.y, '✖', COLORS.lose, 40);
          await Promise.all([this.tween.to(s.scale, { x: 0.3, y: 0.3 }, 260), this.tween.to(s, { alpha: 0 }, 260)]);
          this.slots[at.terrain]![at.side]!.splice(at.index, 1);
          this.sprites.delete(e.uid);
          s.destroy({ children: true });
          this.relayout(at.terrain, at.side);
          break;
        }
        case 'card_moved':
        case 'card_stolen': {
          const at = this.find(e.uid);
          if (!at) break;
          this.slots[at.terrain]![at.side]!.splice(at.index, 1);
          const toTerrain = e.type === 'card_moved' ? e.to : e.terrain;
          const toSide = e.type === 'card_moved' ? at.side : side(e.to);
          this.slots[toTerrain]![toSide]!.push(e.uid);
          this.relayout(at.terrain, at.side);
          this.relayout(toTerrain, toSide);
          await this.tween.wait(300);
          break;
        }
        case 'card_created': {
          if (e.zone !== 'board' || e.terrain === null) break;
          const vs = side(e.player);
          const s = this.sprite(e.uid, 'board');
          s.setMode('board');
          s.setFace({ defId: e.defId, power: e.power });
          const src = e.source ? this.sprites.get(e.source) : undefined;
          const index = this.slots[e.terrain]![vs]!.length;
          this.slots[e.terrain]![vs]!.push(e.uid);
          s.position.set(src?.x ?? this.slotPos(e.terrain, vs, index).x, src?.y ?? this.slotPos(e.terrain, vs, index).y);
          s.scale.set(0.4);
          this.boardLayer.addChild(s);
          await Promise.all([this.tween.to(s.position, this.slotPos(e.terrain, vs, index), 320), this.tween.to(s.scale, { x: 1, y: 1 }, 320, ease.outBack)]);
          break;
        }
        case 'card_transformed': {
          const s = this.sprites.get(e.uid);
          if (!s?.parent || !this.find(e.uid)) break;
          await this.flip(s, { defId: e.to, power: e.power });
          break;
        }
        case 'stake_changed':
          await this.banner(t('hype_banner', { n: e.stake }), COLORS.accent);
          break;
        default:
          break;
      }
    }
    if (!this.destroyed) this.render(finalView, finalOptions);
  }
}
