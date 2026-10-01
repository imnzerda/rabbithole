<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { PROTOTYPE_DECKS, prototypeContext } from '@rabbithole/content';
  import type { GameAction, PlayerView } from '@rabbithole/engine';
  import { onMount } from 'svelte';
  import { GameRenderer, type RenderOptions } from '$lib/game/renderer';
  import { t } from '$lib/i18n';
  import type { MatchClient, MatchStep } from '$lib/match/client';
  import { LocalMatch } from '$lib/match/local-match';
  import CardDetail from '$lib/ui/CardDetail.svelte';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import DecisionPanel from '$lib/ui/DecisionPanel.svelte';
  import EndScreen from '$lib/ui/EndScreen.svelte';
  import RulesSheet from '$lib/ui/RulesSheet.svelte';

  const ctx = prototypeContext();
  const deckId = page.url.searchParams.get('deck');
  const timerEnabled = page.url.searchParams.get('timer') !== '0';
  const myDeck = PROTOTYPE_DECKS.find((d) => d.id === deckId) ?? PROTOTYPE_DECKS[0]!;

  let host: HTMLDivElement;
  let renderer: GameRenderer | null = null;
  let client: MatchClient | null = null;

  let view = $state.raw<PlayerView | null>(null);
  let busy = $state(true);
  let selected = $state<string | null>(null);
  let timeLeft = $state(0);
  let detail = $state<{ defId: string; power: number | null } | null>(null);
  let showRules = $state(false);
  /** Aperçu au survol (PC, écran large uniquement). */
  let hovered = $state<{ defId: string; power: number | null } | null>(null);
  let wide = $state(false);

  const legal = $derived(view?.legal ?? null);
  const myMain = $derived(!busy && legal?.kind === 'main');
  const myReaction = $derived(!busy && !!legal && legal.kind !== 'main');
  const selectedHand = $derived(view?.me.hand.find((c) => c.uid === selected) ?? null);
  const canPlaySelected = $derived(!!selectedHand && !!legal?.playable.includes(selectedHand.uid));
  const canAttachSelected = $derived(!!selected && !!legal?.attachTargets.includes(selected));
  const canActivateSelected = $derived(!!selected && !!legal?.activatable.includes(selected));

  function options(v: PlayerView, interactive: boolean): RenderOptions {
    return { legal: v.legal, selected, interactive: interactive && v.legal?.kind === 'main' };
  }

  function draw(): void {
    if (view && renderer) renderer.render(view, options(view, !busy));
  }

  function resetTimer(): void {
    timeLeft = legal?.kind === 'main' ? ctx.rules.turnTimerSeconds : ctx.rules.reactionTimerSeconds;
  }

  async function playSteps(steps: MatchStep[]): Promise<void> {
    busy = true;
    selected = null;
    for (const step of steps) {
      await renderer?.animate(step.events, step.view, options(step.view, false));
      view = step.view;
    }
    busy = false;
    resetTimer();
    draw();
  }

  async function perform(action: GameAction): Promise<void> {
    if (!client || busy) return;
    busy = true;
    draw();
    try {
      await playSteps(await client.act(action));
    } catch (error) {
      // Action refusée par le moteur : on resynchronise l'affichage.
      console.warn(error);
      busy = false;
      draw();
    }
  }

  /** Action par défaut à l'expiration du minuteur. */
  function timeout(): void {
    switch (legal?.kind) {
      case 'main':
        void perform({ type: 'end_turn' });
        break;
      case 'block':
        void perform({ type: 'block', blocker: null });
        break;
      case 'counter':
        void perform({ type: 'counter', uids: [] });
        break;
      case 'trigger':
        void perform({ type: 'trigger', activate: false });
        break;
      case 'mulligan':
        void perform({ type: 'mulligan', redraw: false });
        break;
    }
  }

  function newMatch(): void {
    const others = PROTOTYPE_DECKS.filter((d) => d.id !== myDeck.id);
    const pick = new Uint32Array(1);
    crypto.getRandomValues(pick);
    const aiDeck = others[pick[0]! % others.length] ?? myDeck;
    client = new LocalMatch(ctx, myDeck, aiDeck);
    view = client.view;
    selected = null;
    void playSteps(client.initialSteps);
  }

  function hype(): void {
    if (legal?.canHype && confirm(t('hype_confirm'))) void perform({ type: 'hype' });
  }

  function fold(): void {
    if (view && !busy && confirm(t('fold_confirm', { n: view.stake }))) void perform({ type: 'fold' });
  }

  onMount(() => {
    const r = new GameRenderer(ctx, {
      onPlay(uid) {
        void perform({ type: 'play', uid });
      },
      onAttack(attacker, target) {
        void perform({ type: 'attack', attacker, target });
      },
      onSelect(uid) {
        selected = uid;
        draw();
      },
      onInspect(defId, power) {
        detail = { defId, power };
      },
      onHover(defId, power) {
        hovered = defId ? { defId, power } : null;
      },
    });
    const media = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 23/20)');
    const syncWide = () => (wide = media.matches);
    syncWide();
    media.addEventListener('change', syncWide);
    renderer = r;
    let cancelled = false;
    void r.init(host).then(() => {
      if (!cancelled) newMatch();
    });

    const timer = setInterval(() => {
      if (!timerEnabled || busy || !legal || detail || showRules || view?.phase === 'ended') return;
      timeLeft -= 1;
      if (timeLeft <= 0) timeout();
    }, 1000);

    if (import.meta.env.DEV) {
      // Points d'accès pour les tests E2E (le plateau est un canvas).
      (window as unknown as Record<string, unknown>).__rabbithole = {
        view: () => view,
        busy: () => busy,
        act: (action: GameAction) => perform(action),
        handCard: (index: number) => r.handCardScreenPosition(index),
      };
    }

    return () => {
      cancelled = true;
      clearInterval(timer);
      media.removeEventListener('change', syncWide);
      r.destroy();
      renderer = null;
    };
  });
</script>

<div class="game">
  <header class="hud top">
    <button class="icon" aria-label={t('menu')} onclick={() => goto('/')}>←</button>
    <div class="info">
      <span class="turn" data-testid="turn">
        {t('turn')} {view?.turn ?? 0} · {view ? (view.active === view.you ? t('your_turn') : t('their_turn')) : ''}
      </span>
      <span class="sub">{view ? t('opp_info', { hand: view.opponent.handCount, deck: view.opponent.deckCount }) : ''}</span>
    </div>
    <div class="stake" class:hot={(view?.stake ?? 1) > 1} title={t('stake')}>×{view?.stake ?? 1}</div>
    <button class="icon" aria-label={t('rules')} onclick={() => (showRules = true)}>?</button>
  </header>

  <div class="board">
    <div class="canvas" bind:this={host}></div>
    {#if view && myReaction}
      <DecisionPanel {ctx} {view} onact={(a) => void perform(a)} />
    {:else if wide && hovered}
      <aside class="preview" aria-live="polite"><CardInfo {ctx} defId={hovered.defId} power={hovered.power} compact /></aside>
    {/if}
  </div>

  <footer class="hud bottom">
    {#if myMain && (canPlaySelected || canAttachSelected || canActivateSelected)}
      <div class="context">
        {#if canPlaySelected && selectedHand}
          <button class="btn btn-primary" data-testid="play-selected" onclick={() => perform({ type: 'play', uid: selectedHand.uid })}>
            {t('play_card', { n: selectedHand.cost })}
          </button>
        {/if}
        {#if canAttachSelected && selected}
          {@const target = selected}
          <button class="btn buzz" onclick={() => perform({ type: 'attach', target })}>{t('attach_buzz')}</button>
        {/if}
        {#if canActivateSelected && selected}
          {@const uid = selected}
          <button class="btn" onclick={() => perform({ type: 'activate', uid })}>{t('activate')}</button>
        {/if}
      </div>
    {:else if myMain && view?.turn !== undefined && view.turn <= 4}
      <p class="hint">{t('hint_main')}</p>
    {/if}
    <div class="row">
      <span class="deck">{view ? t('my_deck', { n: view.me.deckCount }) : ''}</span>
      <button class="btn hype" disabled={!myMain || !legal?.canHype} onclick={hype}>{t('hype')}</button>
      <button class="btn fold" disabled={busy || !view || view.phase === 'ended'} onclick={fold}>{t('fold')}</button>
      <button class="btn btn-primary end" disabled={!myMain} data-testid="end-turn" onclick={() => perform({ type: 'end_turn' })}>
        {myMain || myReaction ? t('end_turn') : t('waiting')}
        {#if timerEnabled && (myMain || myReaction)}<span class="timer" class:urgent={timeLeft <= 10}>{timeLeft}</span>{/if}
      </button>
    </div>
  </footer>
</div>

{#if detail}
  <CardDetail {ctx} defId={detail.defId} power={detail.power} onclose={() => (detail = null)} />
{/if}

{#if showRules}
  <RulesSheet rules={ctx.rules} onclose={() => (showRules = false)} />
{/if}

{#if view?.result && !busy}
  <EndScreen result={view.result} you={view.you} onreplay={newMatch} onmenu={() => goto('/')} />
{/if}

<style>
  .game {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .preview {
    position: absolute;
    top: 12px;
    right: 12px;
    width: min(340px, 26%);
    max-height: calc(100% - 24px);
    overflow-y: auto;
    background: rgb(23 18 37 / 0.94);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 14px 16px;
    pointer-events: none;
    z-index: 15;
  }
  @media (min-width: 900px) {
    .game .hud {
      padding-inline: 20px;
    }
    .game .hud .btn {
      padding: 12px 22px;
      font-size: 17px;
    }
    .game .row {
      justify-content: flex-end;
    }
    .game .row .deck {
      margin-right: auto;
      font-size: 14px;
    }
    .game .row .end {
      flex: 0 1 340px;
    }
    .game .context {
      justify-content: center;
    }
    .game .context .btn {
      flex: 0 1 260px;
    }
    .game .turn {
      font-size: 18px;
    }
    .game .hint {
      font-size: 14px;
    }
  }
  .board {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .canvas {
    position: absolute;
    inset: 0;
    touch-action: none;
  }
  .canvas :global(canvas) {
    position: absolute;
    inset: 0;
    display: block;
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
    flex-direction: column;
    align-items: stretch;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
  }
  .row,
  .context {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .context .btn {
    flex: 1;
  }
  .hud .btn {
    padding: 10px 12px;
    white-space: nowrap;
  }
  .icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    font-weight: 700;
    flex: none;
  }
  .info {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .turn {
    font-weight: 700;
  }
  .sub,
  .deck,
  .hint {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    margin: 0;
    white-space: normal;
    text-align: center;
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
  .buzz {
    color: var(--mana);
    border-color: var(--mana);
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
</style>
