<script lang="ts">
  import type { GameAction, PlayerView } from '@rabbithole/engine';
  import { onMount, untrack } from 'svelte';
  import { GameRenderer, type RenderOptions } from '../game/renderer';
  import { t } from '../i18n';
  import type { MatchClient, MatchStep } from '../match/client';
  import CardDetail from './CardDetail.svelte';
  import CardInfo from './CardInfo.svelte';
  import DecisionPanel from './DecisionPanel.svelte';
  import EndScreen from './EndScreen.svelte';
  import RulesSheet from './RulesSheet.svelte';

  interface Props {
    client: MatchClient;
    /** Quitter (menu, salon). */
    onexit: () => void;
    /** « Rejouer » en fin de partie (absent : pas de bouton). */
    onagain?: () => void;
  }
  let { client, onexit, onagain }: Props = $props();
  // Le composant est recréé pour chaque partie : on fige le client et son catalogue.
  const match = untrack(() => client);
  const ctx = match.ctx;

  let host: HTMLDivElement;
  let renderer: GameRenderer | null = null;

  let view = $state.raw<PlayerView | null>(null);
  let deadline = $state<number | null>(null);
  let now = $state(Date.now());
  let animating = $state(true);
  /** Action envoyée, en attente de la réponse (serveur ou moteur local). */
  let waiting = $state(false);
  let selected = $state<string | null>(null);
  let detail = $state<{ defId: string; power: number | null } | null>(null);
  let showRules = $state(false);
  let toast = $state<string | null>(null);
  /** Aperçu au survol (PC, écran large uniquement). */
  let hovered = $state<{ defId: string; power: number | null } | null>(null);
  let wide = $state(false);

  const busy = $derived(animating || waiting);
  const legal = $derived(match.spectator ? null : (view?.legal ?? null));
  const myMain = $derived(!busy && legal?.kind === 'main');
  const myReaction = $derived(!busy && !!legal && legal.kind !== 'main');
  const selectedHand = $derived(view?.me.hand.find((c) => c.uid === selected) ?? null);
  const canPlaySelected = $derived(!!selectedHand && !!legal?.playable.includes(selectedHand.uid));
  const canAttachSelected = $derived(!!selected && !!legal?.attachTargets.includes(selected));
  const canActivateSelected = $derived(!!selected && !!legal?.activatable.includes(selected));
  const timeLeft = $derived(deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000)));

  function options(v: PlayerView, interactive: boolean): RenderOptions {
    const l = match.spectator ? null : v.legal;
    return { legal: l, selected, interactive: interactive && l?.kind === 'main' };
  }

  function draw(): void {
    if (view && renderer) renderer.render(view, options(view, !busy));
  }

  // Les étapes arrivent en continu (l'adversaire peut agir à tout moment) : on les anime dans l'ordre.
  const queue: MatchStep[] = [];
  let pumping = false;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    animating = true;
    selected = null;
    while (queue.length) {
      const step = queue.shift()!;
      await renderer?.animate(step.events, step.view, options(step.view, false));
      view = step.view;
      deadline = step.deadline;
    }
    pumping = false;
    animating = false;
    waiting = false;
    draw();
  }

  function perform(action: GameAction): void {
    if (busy || match.spectator) return;
    waiting = true;
    selected = null;
    draw();
    match.act(action);
  }

  function hype(): void {
    if (legal?.canHype && confirm(t('hype_confirm'))) perform({ type: 'hype' });
  }

  function fold(): void {
    if (view && !busy && confirm(t('fold_confirm', { n: view.stake }))) perform({ type: 'fold' });
  }

  onMount(() => {
    const r = new GameRenderer(ctx, {
      onPlay(uid) {
        perform({ type: 'play', uid });
      },
      onAttack(attacker, target) {
        perform({ type: 'attack', attacker, target });
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
    const clock = setInterval(() => (now = Date.now()), 250);
    const unsubscribe: (() => void)[] = [];
    let cancelled = false;
    void r.init(host).then(() => {
      if (cancelled) return;
      unsubscribe.push(
        match.onStep((step) => {
          queue.push(step);
          void pump();
        }),
        match.onError((e) => {
          // Action refusée (par le serveur ou le moteur) : on resynchronise l'affichage.
          waiting = false;
          toast = e.message;
          setTimeout(() => (toast = null), 2500);
          draw();
        }),
      );
      match.start();
    });

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
      clearInterval(clock);
      for (const u of unsubscribe) u();
      media.removeEventListener('change', syncWide);
      match.close();
      r.destroy();
      renderer = null;
    };
  });
</script>

<div class="game">
  <header class="hud top">
    <button class="icon" aria-label={t('menu')} onclick={onexit}>←</button>
    <div class="info">
      <span class="turn" data-testid="turn">
        {t('turn')} {view?.turn ?? 0} · {view ? (view.active === view.you ? t('your_turn') : t('their_turn')) : ''}
      </span>
      <span class="sub">
        {t('versus', { name: match.opponentName })}{view ? ' · ' + t('opp_info', { hand: view.opponent.handCount, deck: view.opponent.deckCount }) : ''}
      </span>
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
    {#if toast}<div class="toast" role="status">{toast}</div>{/if}
  </div>

  {#if !match.spectator}
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
        {#if timeLeft !== null && (myMain || myReaction)}<span class="timer" class:urgent={timeLeft <= 10}>{timeLeft}</span>{/if}
      </button>
    </div>
  </footer>
  {/if}
</div>

{#if detail}
  <CardDetail {ctx} defId={detail.defId} power={detail.power} onclose={() => (detail = null)} />
{/if}

{#if showRules}
  <RulesSheet rules={ctx.rules} onclose={() => (showRules = false)} />
{/if}

{#if view?.result && !busy}
  <EndScreen result={view.result} you={view.you} onreplay={onagain} onmenu={onexit} />
{/if}

<style>
  .game {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .toast {
    position: absolute;
    left: 50%;
    top: 12px;
    transform: translateX(-50%);
    background: var(--lose);
    color: white;
    padding: 8px 14px;
    border-radius: 12px;
    font-weight: 700;
    z-index: 30;
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
