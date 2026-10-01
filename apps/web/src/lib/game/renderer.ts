import type { LegalActions, MatchContext, MatchEvent, PlayerIndex, PlayerView, VisibleCard } from '@rabbithole/engine';
import { KEYWORD_NAMES } from '@rabbithole/engine';
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { locale, t } from '../i18n';
import { CardSprite, type CardFace, type Highlight } from './card-sprite';
import { COLORS, FONT } from './theme';
import { ease, Tweener } from './tween';

// ---------------------------------------------------------------------------
// Disposition logique (portrait), mise à l'échelle de l'écran.
// ---------------------------------------------------------------------------

export const LOGICAL = { w: 720, h: 1020 };
const SLOT_X = (i: number) => 92 + i * 134;
const LEADER_X = 360;
const SIDE_X = { life: 150, buzz: 570 };
const ROW = { oppLeader: 104, oppChars: 296, myChars: 494, myLeader: 686 };
const HAND_Y = 900;
const DIVIDER_Y = 395;
const RESTED = { rotation: Math.PI / 2, scale: 0.75 };

export interface RendererCallbacks {
  onPlay(uid: string): void;
  onAttack(attacker: string, target: string): void;
  onSelect(uid: string | null): void;
  onInspect(defId: string, power: number | null): void;
}

export interface RenderOptions {
  /** Actions légales du joueur (null si ce n'est pas à lui de décider). */
  legal: LegalActions | null;
  selected: string | null;
  interactive: boolean;
}

interface Press {
  sprite: CardSprite;
  origin: 'hand' | 'mine' | 'enemy';
  startX: number;
  startY: number;
  dragging: boolean;
  longPressed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/** Pile de Vies (dos de cartes empilés + nombre). */
class LifePile extends Container {
  private readonly g = new Graphics();
  private readonly value = new Text({ text: '', style: { fontFamily: FONT, fontSize: 22, fontWeight: '700', fill: COLORS.text }, resolution: 2 });
  private readonly caption = new Text({ text: '', style: { fontFamily: FONT, fontSize: 12, fill: COLORS.muted }, resolution: 2 });
  count = -1;

  constructor() {
    super();
    this.value.anchor.set(0.5);
    this.caption.anchor.set(0.5);
    this.addChild(this.g, this.value, this.caption);
  }

  update(count: number): void {
    if (count === this.count) return;
    this.count = count;
    this.g.clear();
    const shown = Math.min(count, 6);
    for (let i = 0; i < shown; i++) {
      this.g.roundRect(-34 + i * 3, -46 - i * 4, 68, 90, 8).fill(COLORS.cardBack).stroke({ width: 2, color: count <= 2 ? COLORS.lose : COLORS.accent, alpha: 0.8 });
    }
    if (count === 0) this.g.roundRect(-34, -46, 68, 90, 8).stroke({ width: 2, color: COLORS.lose, alpha: 0.6 });
    this.value.text = `❤ ${count}`;
    this.value.style.fill = count <= 2 ? COLORS.lose : COLORS.text;
    this.value.position.set(shown * 1.5, -4 - shown * 2);
    this.caption.text = t('life');
    this.caption.position.set(0, 60);
  }
}

/** Indicateur de Buzz : actif / épuisé. */
class BuzzMeter extends Container {
  private readonly value = new Text({ text: '', style: { fontFamily: FONT, fontSize: 24, fontWeight: '700', fill: COLORS.mana }, resolution: 2 });
  private readonly caption = new Text({ text: '', style: { fontFamily: FONT, fontSize: 12, fill: COLORS.muted, align: 'center' }, resolution: 2 });

  constructor() {
    super();
    this.value.anchor.set(0.5);
    this.caption.anchor.set(0.5, 0);
    this.caption.position.set(0, 20);
    this.addChild(this.value, this.caption);
  }

  update(active: number, rested: number, reserve: number): void {
    this.value.text = `⚡ ${active}`;
    this.caption.text = `${t('buzz_rested', { n: rested })}\n${t('buzz_reserve', { n: reserve })}`;
  }
}

export class GameRenderer {
  readonly app = new Application();
  private tween!: Tweener;
  private readonly root = new Container();
  /** Plateau (fond, cartes en jeu, effets) : descend un peu sur un écran haut. */
  private readonly boardRoot = new Container();
  private readonly backLayer = new Container();
  private readonly boardLayer = new Container();
  private readonly handLayer = new Container();
  private readonly dragLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly sprites = new Map<string, CardSprite>();
  private readonly lifePiles: [LifePile, LifePile] = [new LifePile(), new LifePile()];
  private readonly buzz: [BuzzMeter, BuzzMeter] = [new BuzzMeter(), new BuzzMeter()];
  /** Position de repos de chaque sprite (pour le retour après un glisser). */
  private readonly homes = new Map<string, { x: number; y: number; rested: boolean }>();
  private handOrder: string[] = [];
  private myBoard = new Set<string>();
  private enemyBoard = new Set<string>();

  private view: PlayerView | null = null;
  private options: RenderOptions = { legal: null, selected: null, interactive: false };
  private press: Press | null = null;
  private destroyed = false;
  private scale = 1;

  constructor(
    private readonly ctx: MatchContext,
    private readonly callbacks: RendererCallbacks,
  ) {}

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

    this.boardRoot.addChild(this.backLayer, this.boardLayer, this.fxLayer);
    this.root.addChild(this.boardRoot, this.handLayer, this.dragLayer);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('globalpointermove', (e) => this.onMove(e));
    this.app.stage.on('pointerup', (e) => this.onUp(e));
    this.app.stage.on('pointerupoutside', (e) => this.onUp(e));
    this.app.stage.on('pointertap', (e) => {
      if (e.target === this.app.stage && this.options.interactive) this.callbacks.onSelect(null);
    });

    this.drawBackground();
    this.lifePiles[0].position.set(SIDE_X.life, ROW.myLeader);
    this.lifePiles[1].position.set(SIDE_X.life, ROW.oppLeader);
    this.buzz[0].position.set(SIDE_X.buzz, ROW.myLeader - 14);
    this.buzz[1].position.set(SIDE_X.buzz, ROW.oppLeader - 14);
    this.backLayer.addChild(...this.lifePiles, ...this.buzz);

    this.app.renderer.on('resize', () => this.fit());
    this.fit();
  }

  private drawBackground(): void {
    const g = new Graphics();
    g.roundRect(14, ROW.oppChars - 96, LOGICAL.w - 28, 192, 20).fill(COLORS.zone).stroke({ width: 1, color: COLORS.zoneLine });
    g.roundRect(14, ROW.myChars - 96, LOGICAL.w - 28, 192, 20).fill(COLORS.zone).stroke({ width: 1, color: COLORS.zoneLine });
    g.moveTo(40, DIVIDER_Y).lineTo(LOGICAL.w - 40, DIVIDER_Y).stroke({ width: 2, color: COLORS.accent, alpha: 0.35 });
    this.backLayer.addChild(g);
  }

  private fit(): void {
    const { width, height } = this.app.screen;
    this.scale = Math.min(width / LOGICAL.w, height / LOGICAL.h);
    this.root.scale.set(this.scale);
    // Sur un écran plus haut que la disposition : la main se colle en bas, le plateau descend un peu.
    const extra = Math.max(0, height / this.scale - LOGICAL.h);
    this.boardRoot.y = Math.round(extra * 0.4);
    this.handLayer.y = Math.round(extra * 0.9);
    this.root.position.set((width - LOGICAL.w * this.scale) / 2, 0);
    this.app.stage.hitArea = this.app.screen;
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

  private sprite(uid: string, mode: 'board' | 'hand', spawn: { x: number; y: number }): CardSprite {
    let s = this.sprites.get(uid);
    if (!s) {
      s = new CardSprite(this.ctx, uid, mode);
      s.position.set(spawn.x, spawn.y);
      s.on('pointerdown', (e) => this.onCardDown(s!, e));
      this.sprites.set(uid, s);
    }
    return s;
  }

  private faceOf(c: VisibleCard, inHand: boolean): CardFace {
    return {
      defId: c.defId,
      power: c.type === 'event' ? null : c.power,
      cost: inHand ? c.cost : undefined,
      counter: inHand ? c.counter : undefined,
      buzz: c.buzz,
      cancelled: c.cancelled,
      trending: c.trending,
    };
  }

  private highlightOf(uid: string): Highlight {
    const legal = this.options.legal;
    if (!legal || !this.options.interactive) return null;
    if (legal.playable.includes(uid)) return 'playable';
    const selected = legal.attackers.find((a) => a.uid === this.options.selected);
    if (selected?.targets.includes(uid)) return 'target';
    if (legal.attackers.some((a) => a.uid === uid)) return 'ready';
    return null;
  }

  /** Change de conteneur en gardant la position à l'écran. */
  private reparent(s: CardSprite, layer: Container): void {
    if (s.parent === layer) return;
    if (s.parent) {
      const p = layer.toLocal(s.getGlobalPosition());
      s.position.set(p.x, p.y);
    }
    layer.addChild(s);
  }

  private place(s: CardSprite, x: number, y: number, rested: boolean, layer: Container): void {
    this.homes.set(s.cardUid, { x, y, rested });
    this.reparent(s, layer);
    void this.tween.to(s.position, { x, y }, 280);
    void this.tween.to(s, { rotation: rested ? RESTED.rotation : 0 }, 220);
    const scale = rested ? RESTED.scale : 1;
    void this.tween.to(s.scale, { x: scale, y: scale }, 220);
    s.alpha = 1;
  }

  /** Met l'affichage en conformité avec la vue (qui fait foi). */
  render(view: PlayerView, options: RenderOptions): void {
    if (this.destroyed || !this.tween) return;
    this.view = view;
    this.options = options;
    const keep = new Set<string>();
    this.myBoard = new Set();
    this.enemyBoard = new Set();

    const sides: [typeof view.me, typeof view.opponent] = [view.me, view.opponent];
    sides.forEach((side, i) => {
      const mine = i === 0;
      const leaderY = mine ? ROW.myLeader : ROW.oppLeader;
      const charsY = mine ? ROW.myChars : ROW.oppChars;
      const boardSet = mine ? this.myBoard : this.enemyBoard;

      const leader = this.sprite(side.leader.uid, 'board', { x: LEADER_X, y: leaderY });
      leader.setMode('board');
      leader.setFace(this.faceOf(side.leader, false));
      this.place(leader, LEADER_X, leaderY, side.leader.rested, this.boardLayer);
      keep.add(side.leader.uid);
      boardSet.add(side.leader.uid);

      side.characters.forEach((c, slot) => {
        const s = this.sprite(c.uid, 'board', { x: LEADER_X, y: mine ? LOGICAL.h + 100 : -120 });
        s.setMode('board');
        s.setFace(this.faceOf(c, false));
        this.place(s, SLOT_X(slot), charsY, c.rested, this.boardLayer);
        keep.add(c.uid);
        boardSet.add(c.uid);
      });

      this.lifePiles[i]!.update(side.life);
      this.buzz[i]!.update(side.buzzActive, side.buzzRested, side.buzzDeck);
    });

    this.handOrder = view.me.hand.map((c) => c.uid);
    for (const c of view.me.hand) {
      const s = this.sprite(c.uid, 'hand', { x: LOGICAL.w + 80, y: HAND_Y });
      s.setMode('hand');
      s.setFace(this.faceOf(c, true));
      keep.add(c.uid);
    }
    this.layoutHand();

    for (const [uid, s] of this.sprites) {
      s.setState(uid === options.selected, this.highlightOf(uid));
      if (keep.has(uid)) continue;
      this.sprites.delete(uid);
      this.homes.delete(uid);
      void this.tween.to(s, { alpha: 0 }, 200).then(() => s.destroy({ children: true }));
    }
  }

  private layoutHand(): void {
    const n = this.handOrder.length;
    const spacing = n > 1 ? Math.min(136, (LOGICAL.w - 24 - 128) / (n - 1)) : 0;
    const start = LOGICAL.w / 2 - (spacing * (n - 1)) / 2;
    this.handOrder.forEach((uid, i) => {
      const s = this.sprites.get(uid);
      if (!s) return;
      const raised = uid === this.options.selected ? 24 : 0;
      this.place(s, start + i * spacing, HAND_Y - raised, false, this.handLayer);
    });
  }

  private refresh(): void {
    if (this.view) this.render(this.view, this.options);
  }

  /** Position écran (pixels CSS) d'une carte de la main : utilisé par les tests E2E. */
  handCardScreenPosition(index: number): { x: number; y: number } | null {
    const s = this.sprites.get(this.handOrder[index] ?? '');
    if (!s) return null;
    const p = s.getGlobalPosition();
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  private local(e: FederatedPointerEvent): { x: number; y: number } {
    return this.root.toLocal(e.global);
  }

  private onCardDown(sprite: CardSprite, e: FederatedPointerEvent): void {
    e.stopPropagation();
    if (this.press) clearTimeout(this.press.timer);
    const uid = sprite.cardUid;
    const origin = this.handOrder.includes(uid) ? 'hand' : this.myBoard.has(uid) ? 'mine' : 'enemy';
    const p = this.local(e);
    const press: Press = {
      sprite,
      origin,
      startX: p.x,
      startY: p.y,
      dragging: false,
      longPressed: false,
      timer: setTimeout(() => {
        if (this.press !== press || press.dragging || !sprite.face.defId) return;
        press.longPressed = true;
        this.callbacks.onInspect(sprite.face.defId, sprite.face.power);
      }, 450),
    };
    this.press = press;
  }

  private canDrag(press: Press): boolean {
    const legal = this.options.legal;
    if (!legal || !this.options.interactive) return false;
    if (press.origin === 'hand') return legal.playable.includes(press.sprite.cardUid);
    if (press.origin === 'mine') return legal.attackers.some((a) => a.uid === press.sprite.cardUid);
    return false;
  }

  private onMove(e: FederatedPointerEvent): void {
    const press = this.press;
    if (!press || press.longPressed) return;
    const p = this.local(e);
    if (!press.dragging) {
      if (Math.hypot(p.x - press.startX, p.y - press.startY) < 10 || !this.canDrag(press)) return;
      press.dragging = true;
      clearTimeout(press.timer);
      if (press.origin === 'mine') this.callbacks.onSelect(press.sprite.cardUid);
      this.reparent(press.sprite, this.dragLayer);
      void this.tween.to(press.sprite, { rotation: 0 }, 100);
      void this.tween.to(press.sprite.scale, { x: 1.05, y: 1.05 }, 100);
    }
    press.sprite.position.set(p.x, p.y - 20);
  }

  /** Cible adverse sous le pointeur (Leader ou Personnage), parmi les cibles légales de l'attaquant. */
  private targetAt(attacker: string, x: number, y: number): string | null {
    y -= this.boardRoot.y;
    const targets = this.options.legal?.attackers.find((a) => a.uid === attacker)?.targets ?? [];
    for (const uid of targets) {
      const home = this.homes.get(uid);
      if (home && Math.abs(home.x - x) < 70 && Math.abs(home.y - y) < 90) return uid;
    }
    return null;
  }

  private onUp(e: FederatedPointerEvent): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    clearTimeout(press.timer);
    if (press.longPressed) return;
    const uid = press.sprite.cardUid;

    if (press.dragging) {
      const p = this.local(e);
      if (press.origin === 'hand' && p.y < HAND_Y + this.handLayer.y - 110) {
        this.callbacks.onPlay(uid);
        return;
      }
      if (press.origin === 'mine') {
        const target = this.targetAt(uid, p.x, p.y);
        if (target) {
          this.callbacks.onAttack(uid, target);
          return;
        }
      }
      this.refresh();
      return;
    }

    // Tap.
    const legal = this.options.legal;
    if (press.origin === 'enemy') {
      const selected = this.options.selected;
      const isTarget = legal?.attackers.find((a) => a.uid === selected)?.targets.includes(uid);
      if (selected && isTarget && this.options.interactive) this.callbacks.onAttack(selected, uid);
      else if (press.sprite.face.defId) this.callbacks.onInspect(press.sprite.face.defId, press.sprite.face.power);
      return;
    }
    if (!this.options.interactive) {
      if (press.sprite.face.defId) this.callbacks.onInspect(press.sprite.face.defId, press.sprite.face.power);
      return;
    }
    this.callbacks.onSelect(this.options.selected === uid ? null : uid);
  }

  // -------------------------------------------------------------------------
  // Animations
  // -------------------------------------------------------------------------

  private float(x: number, y: number, label: string, color: number, size = 24): void {
    const txt = new Text({
      text: label,
      style: { fontFamily: FONT, fontSize: size, fontWeight: '700', fill: color, stroke: { color: 0x000000, width: 4 } },
      resolution: 2,
    });
    txt.anchor.set(0.5);
    txt.position.set(x, y);
    this.fxLayer.addChild(txt);
    void this.tween.to(txt.position, { y: y - 46 }, 900);
    void this.tween.to(txt, { alpha: 0 }, 900, ease.linear).then(() => txt.destroy());
  }

  /** Grand bandeau au centre (tour, Hype). */
  async banner(label: string, color: number = COLORS.text): Promise<void> {
    if (!this.tween || this.destroyed) return;
    const box = new Container();
    const txt = new Text({ text: label, style: { fontFamily: FONT, fontSize: 38, fontWeight: '700', fill: color }, resolution: 2 });
    txt.anchor.set(0.5);
    const bg = new Graphics().roundRect(-txt.width / 2 - 28, -34, txt.width + 56, 68, 34).fill({ color: 0x000000, alpha: 0.78 });
    box.addChild(bg, txt);
    box.position.set(LOGICAL.w / 2, DIVIDER_Y);
    box.scale.set(0.6);
    box.alpha = 0;
    this.fxLayer.addChild(box);
    await Promise.all([this.tween.to(box.scale, { x: 1, y: 1 }, 240, ease.outBack), this.tween.to(box, { alpha: 1 }, 180)]);
    await this.tween.wait(550);
    await this.tween.to(box, { alpha: 0 }, 220);
    box.destroy({ children: true });
  }

  /** Montre une carte en grand au centre (Événement joué, Déclencheur, Contre). */
  private async showcase(defId: string, caption: string): Promise<void> {
    const s = new CardSprite(this.ctx, `showcase-${defId}`, 'hand');
    s.eventMode = 'none';
    s.setFace({ defId, power: null });
    s.position.set(LOGICAL.w / 2, DIVIDER_Y);
    s.scale.set(0.5);
    s.alpha = 0;
    const label = new Text({ text: caption, style: { fontFamily: FONT, fontSize: 20, fontWeight: '700', fill: COLORS.accent, stroke: { color: 0x000000, width: 4 } }, resolution: 2 });
    label.anchor.set(0.5);
    label.position.set(LOGICAL.w / 2, DIVIDER_Y + 120);
    this.fxLayer.addChild(s, label);
    await Promise.all([this.tween.to(s.scale, { x: 1.25, y: 1.25 }, 260, ease.outBack), this.tween.to(s, { alpha: 1 }, 200)]);
    await this.tween.wait(650);
    await Promise.all([this.tween.to(s, { alpha: 0 }, 220), this.tween.to(label, { alpha: 0 }, 220)]);
    s.destroy({ children: true });
    label.destroy();
  }

  private async shake(s: CardSprite): Promise<void> {
    const x = s.x;
    for (const dx of [-10, 10, -6, 6, 0]) await this.tween.to(s.position, { x: x + dx }, 45, ease.linear);
  }

  /** Joue les événements d'une étape, puis se cale sur la vue. */
  async animate(events: MatchEvent[], view: PlayerView, options: RenderOptions): Promise<void> {
    if (!this.tween || this.destroyed) return;
    const me: PlayerIndex = view.you;
    const lifeAnchor = (p: PlayerIndex) => this.lifePiles[p === me ? 0 : 1]!.position;

    for (const e of events) {
      if (this.destroyed) return;
      switch (e.type) {
        case 'turn_started':
          if (e.turn > 1 || e.player !== me) await this.banner(e.player === me ? t('your_turn') : t('their_turn'), e.player === me ? COLORS.win : COLORS.text);
          break;
        case 'card_played':
          if (e.cardType === 'event') await this.showcase(e.defId, t('event').toUpperCase());
          break;
        case 'attack_declared': {
          const a = this.sprites.get(e.attacker);
          const target = this.homes.get(e.target);
          if (!a || !target) break;
          const from = { x: a.x, y: a.y };
          await this.tween.to(a.position, { x: from.x + (target.x - from.x) * 0.45, y: from.y + (target.y - from.y) * 0.45 }, 220, ease.inOutCubic);
          this.float(target.x, target.y - 70, '⚔', COLORS.lose, 34);
          await this.tween.to(a.position, from, 200);
          break;
        }
        case 'blocked': {
          const s = this.sprites.get(e.blocker);
          if (s) this.float(s.x, s.y - 70, t('blocked'), COLORS.mana);
          await this.tween.wait(350);
          break;
        }
        case 'counter_played':
          if (e.value > 0) {
            const target = this.view?.battle ? this.homes.get(this.view.battle.target) : undefined;
            this.float(target?.x ?? LOGICAL.w / 2, (target?.y ?? DIVIDER_Y) - 40, `${t('counter')} +${e.value}`, COLORS.win);
            await this.tween.wait(350);
          } else {
            await this.showcase(e.defId, t('counter').toUpperCase());
          }
          break;
        case 'battle_resolved': {
          const s = this.sprites.get(e.target);
          const home = this.homes.get(e.target);
          this.float(home?.x ?? LOGICAL.w / 2, (home?.y ?? DIVIDER_Y) + 10, `${e.attackerPower} vs ${e.defenderPower}`, e.hit ? COLORS.lose : COLORS.win, 26);
          if (e.hit && s) await this.shake(s);
          else await this.tween.wait(350);
          break;
        }
        case 'life_lost': {
          const at = lifeAnchor(e.player);
          this.float(at.x, at.y - 40, `−1 ❤`, COLORS.lose, 28);
          this.lifePiles[e.player === me ? 0 : 1]!.update(e.remaining);
          await this.tween.wait(300);
          break;
        }
        case 'trigger_revealed':
          await this.showcase(e.defId, t('trigger').toUpperCase());
          break;
        case 'card_ko': {
          const s = this.sprites.get(e.uid);
          if (!s) break;
          this.float(s.x, s.y, 'KO', COLORS.lose, 34);
          await Promise.all([this.tween.to(s.scale, { x: 0.3, y: 0.3 }, 280), this.tween.to(s, { alpha: 0 }, 280)]);
          break;
        }
        case 'card_bounced': {
          const s = this.sprites.get(e.uid);
          if (s) await this.tween.to(s, { alpha: 0 }, 250);
          break;
        }
        case 'keyword_triggered': {
          const s = this.sprites.get(e.uid);
          if (s?.parent) this.float(s.x, s.y - 60, KEYWORD_NAMES[e.keyword][locale].toUpperCase(), COLORS.accent, 20);
          await this.tween.wait(250);
          break;
        }
        case 'power_changed': {
          const s = this.sprites.get(e.uid);
          if (!s?.parent || this.handOrder.includes(e.uid)) break;
          s.setPower(e.power);
          this.float(s.x, s.y - 20, e.delta > 0 ? `+${e.delta}` : `${e.delta}`, e.delta > 0 ? COLORS.win : COLORS.lose);
          await this.tween.wait(180);
          break;
        }
        case 'stake_changed':
          await this.banner(t('hype_banner', { n: e.stake }), COLORS.accent);
          break;
        default:
          break;
      }
    }
    if (!this.destroyed) this.render(view, options);
  }
}
