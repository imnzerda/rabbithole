<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { PROTOTYPE_DECKS, prototypeContext } from '@rabbithole/content';
  import { loc, t } from '$lib/i18n';
  import { GameRenderer, type RenderOptions } from '$lib/game/renderer';
  import type { MatchClient } from '$lib/match/client';
  import { LocalMatch } from '$lib/match/local-match';
  import CardDetail from '$lib/ui/CardDetail.svelte';
  import EndScreen from '$lib/ui/EndScreen.svelte';
  import InfoSheet from '$lib/ui/InfoSheet.svelte';
  import RulesSheet from '$lib/ui/RulesSheet.svelte';
  import type { MatchEvent, Play, PlayerView } from '@rabbithole/engine';
  import { onMount } from 'svelte';

  const ctx = prototypeContext();
  const deckId = page.url.searchParams.get('deck');
  const timerEnabled = page.url.searchParams.get('timer') !== '0';
  const myDeck = PROTOTYPE_DECKS.find((d) => d.id === deckId) ?? PROTOTYPE_DECKS[0]!;

  let host: HTMLDivElement;
  let renderer: GameRenderer | null = null;
  let client: MatchClient | null = null;

  let view = $state.raw<PlayerView | null>(null);
  let staged = $state.raw<Play[]>([]);
  let busy = $state(true);
  let timeLeft = $state(ctx.rules.turnTimerSeconds);
  let detail = $state<{ defId: string; power: number | null } | null>(null);
  let terrainDetail = $state<number | null>(null);
  let showRules = $state(false);

  const me = $derived(view?.you ?? 0);
  const opp = $derived(me === 0 ? 1 : 0);
  const manaUsed = $derived(
    view ? staged.reduce((sum, p) => sum + (view!.hand.find((c) => c.uid === p.uid)?.costByTerrain?.[p.terrain] ?? 0), 0) : 0,
  );
  const planning = $derived(view?.phase === 'planning');
  const canHype = $derived(!!view && planning && !busy && !view.hypeDeclared[me] && view.stake < ctx.rules.hype.maxStake);

  /** Vérifications d'interface (le moteur revalide à la soumission). */
  function canDrop(uid: string, terrain: number): boolean {
    const v = view;
    if (!v || v.phase !== 'planning' || busy) return false;
    const tv = v.terrains[terrain];
    const card = v.hand.find((c) => c.uid === uid);
    if (!tv || !card) return false;
    if (!tv.revealed && !ctx.rules.allowPlayOnUnrevealedTerrain) return false;
    const others = staged.filter((p) => p.uid !== uid);
    const count = tv.cards[v.you].length + others.filter((p) => p.terrain === terrain).length;
    if (count >= ctx.rules.maxCardsPerTerrain) return false;
    const used = others.reduce((sum, p) => sum + (v.hand.find((c) => c.uid === p.uid)?.costByTerrain?.[p.terrain] ?? 0), 0);
    return used + (card.costByTerrain?.[terrain] ?? card.cost ?? 0) <= v.mana;
  }

  function options(): RenderOptions {
    return { staged, interactive: !busy && view?.phase === 'planning', canDrop };
  }

  function draw(): void {
    if (view && renderer) renderer.render(view, options());
  }

  async function play(events: MatchEvent[], next: PlayerView): Promise<void> {
    busy = true;
    staged = [];
    await renderer?.animate(events, next, { staged: [], interactive: false, canDrop: () => false });
    view = next;
    busy = false;
    timeLeft = ctx.rules.turnTimerSeconds;
    draw();
  }

  function newMatch(): void {
    const others = PROTOTYPE_DECKS.filter((d) => d.id !== myDeck.id);
    const pick = new Uint32Array(1);
    crypto.getRandomValues(pick);
    const aiDeck = others[pick[0]! % others.length] ?? myDeck;
    client = new LocalMatch(ctx, myDeck.cards, aiDeck.cards);
    staged = [];
    view = client.view;
    busy = false;
    timeLeft = ctx.rules.turnTimerSeconds;
    draw();
    void renderer?.banner(t('turn_banner', { n: 1 }));
  }

  async function endTurn(): Promise<void> {
    if (!client || busy || !planning) return;
    busy = true;
    draw();
    const update = await client.submitTurn(staged);
    await play(update.events, update.view);
  }

  async function hype(): Promise<void> {
    if (!client || !canHype || !confirm(t('hype_confirm'))) return;
    const update = await client.hype();
    await play(update.events, update.view);
  }

  async function fold(): Promise<void> {
    if (!client || busy || !planning || !view || !confirm(t('fold_confirm', { n: view.stake }))) return;
    const update = await client.fold();
    await play(update.events, update.view);
  }

  onMount(() => {
    const r = new GameRenderer(ctx, {
      onDrop(uid, terrain) {
        if (!canDrop(uid, terrain)) return false;
        staged = [...staged.filter((p) => p.uid !== uid), { uid, terrain }];
        draw();
        return true;
      },
      onUnstage(uid) {
        staged = staged.filter((p) => p.uid !== uid);
        draw();
      },
      onInspectCard(defId, power) {
        detail = { defId, power };
      },
      onInspectTerrain(index) {
        if (view?.terrains[index]?.defId) terrainDetail = index;
      },
    });
    renderer = r;
    let cancelled = false;
    void r.init(host).then(() => {
      if (!cancelled) newMatch();
    });

    const timer = setInterval(() => {
      if (!timerEnabled || busy || !planning || detail || showRules || terrainDetail !== null) return;
      timeLeft -= 1;
      if (timeLeft <= 0) void endTurn();
    }, 1000);

    if (import.meta.env.DEV) {
      // Points d'accès pour les tests E2E (le plateau est un canvas).
      (window as unknown as Record<string, unknown>).__rabbithole = {
        view: () => view,
        stage: (handIndex: number, terrain: number) => {
          const uid = view?.hand[handIndex]?.uid;
          return uid ? r['callbacks'].onDrop(uid, terrain) : false;
        },
        handCard: (handIndex: number) => r.handCardScreenPosition(handIndex),
      };
    }

    return () => {
      cancelled = true;
      clearInterval(timer);
      r.destroy();
      renderer = null;
    };
  });
</script>

<div class="game">
  <header class="hud top">
    <button class="icon" aria-label={t('menu')} onclick={() => goto('/')}>←</button>
    <div class="info">
      <span class="turn" data-testid="turn">{t('turn')} {view?.turn ?? 1}/{ctx.rules.turns}</span>
      <span class="order">{view ? (view.revealFirst === me ? t('you_reveal_first') : t('they_reveal_first')) : ''}</span>
    </div>
    <div class="stake" class:hot={(view?.stake ?? 1) > 1} title={t('stake')}>×{view?.stake ?? 1}</div>
    <span class="opp-hand">{t('opp_hand', { n: view?.opponentHandCount ?? 0 })}</span>
    <button class="icon" aria-label={t('rules')} onclick={() => (showRules = true)}>?</button>
  </header>

  <div class="board" bind:this={host}></div>

  <footer class="hud bottom">
    <div class="mana" data-testid="mana" aria-label={t('mana')}>
      <span class="mana-value">{(view?.mana ?? 0) - manaUsed}</span>
      <span class="mana-max">/ {view?.mana ?? 0}</span>
    </div>
    <button class="btn hype" disabled={!canHype} onclick={hype}>{t('hype')}</button>
    <button class="btn fold" disabled={busy || !planning} onclick={fold}>{t('fold')}</button>
    <button class="btn btn-primary end" disabled={busy || !planning} data-testid="end-turn" onclick={endTurn}>
      {busy ? t('waiting') : t('end_turn')}
      {#if timerEnabled && !busy && planning}<span class="timer" class:urgent={timeLeft <= 10}>{timeLeft}</span>{/if}
    </button>
  </footer>
</div>

{#if detail}
  <CardDetail {ctx} defId={detail.defId} power={detail.power} onclose={() => (detail = null)} />
{/if}

{#if terrainDetail !== null && view}
  {@const def = ctx.terrains[view.terrains[terrainDetail]?.defId ?? '']}
  {#if def}
    <InfoSheet title={loc(def.name)} onclose={() => (terrainDetail = null)}>
      <p class="terrain-desc">{loc(def.description)}</p>
    </InfoSheet>
  {/if}
{/if}

{#if showRules}
  <RulesSheet rules={ctx.rules} onclose={() => (showRules = false)} />
{/if}

{#if view?.result && !busy}
  <EndScreen
    {ctx}
    result={view.result}
    you={me}
    terrainIds={view.terrains.map((tv) => tv.defId)}
    onreplay={newMatch}
    onmenu={() => goto('/')}
  />
{/if}

<style>
  .game {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    max-width: 760px;
    margin: 0 auto;
  }
  .board {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    touch-action: none;
  }
  .board :global(canvas) {
    position: absolute;
    inset: 0;
    display: block;
  }
  .hud .btn {
    padding: 10px 12px;
    white-space: nowrap;
  }
  .hud {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-2);
  }
  .top {
    padding-top: max(8px, env(safe-area-inset-top));
    border-bottom: 1px solid var(--line);
  }
  .bottom {
    padding-bottom: max(10px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
  }
  .icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    font-weight: 700;
  }
  .info {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .turn {
    font-weight: 700;
  }
  .order,
  .opp-hand {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stake {
    font-weight: 700;
    font-size: 18px;
    padding: 4px 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
  }
  .stake.hot {
    color: var(--accent);
    border-color: var(--accent);
  }
  .mana {
    display: flex;
    align-items: baseline;
    gap: 2px;
    background: var(--mana);
    color: #06131f;
    border-radius: 12px;
    padding: 6px 12px;
    font-weight: 700;
  }
  .mana-value {
    font-size: 22px;
  }
  .mana-max {
    font-size: 13px;
  }
  .hype {
    color: var(--accent);
    border-color: var(--accent);
  }
  .end {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .timer {
    font-size: 13px;
    background: rgb(0 0 0 / 0.25);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .timer.urgent {
    background: var(--lose);
  }
  .terrain-desc {
    margin: 0;
    line-height: 1.4;
  }
</style>
