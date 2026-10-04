<script lang="ts">
  import { goto } from '$app/navigation';
  import type { DeckDto, TournamentDto, TournamentsDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { errorText, loc, locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  /**
   * Tournoi hebdomadaire (section 7) : inscription avec un deck, tableau à élimination directe, match du tour à jouer
   * en direct (sinon tranché par simulation à l'échéance), classement et récompenses. Le serveur décide de tout.
   */
  let { data } = $props();
  const { ctx } = untrack(() => data.catalog);

  let info = $state.raw<TournamentsDto | null>(null);
  let decks = $state.raw<DeckDto[]>([]);
  let deckId = $state<string | null>(null);
  let detail = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/tournaments');
      [info, decks] = await Promise.all([api.tournaments().catch(() => null), api.decks().then((r) => r.decks).catch(() => [])]);
      deckId = decks[0]?.id ?? null;
    })();
  });

  async function call(fn: () => Promise<TournamentsDto>, done?: string): Promise<void> {
    busy = true;
    message = null;
    try {
      info = await fn();
      if (done) message = done;
    } catch (e) {
      message = e instanceof ApiError ? errorText(e.code) : t('err_generic');
    } finally {
      busy = false;
    }
  }

  const when = (iso: string | null, long = false) =>
    iso ? new Date(iso).toLocaleString(locale, long ? { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  /** « Champion », « Finaliste », « Top 4 »… */
  const place = (top: number) => (top === 1 ? t('tournament_champion') : top === 2 ? t('tournament_finalist') : t('tournament_top', { n: top }));
  const roundName = (r: number, rounds: number) => (r === rounds ? t('tournament_final') : r === rounds - 1 ? t('tournament_semis') : t('tournament_round', { n: r }));
</script>

{#snippet bracket(tr: TournamentDto)}
  <div class="bracket" data-testid="bracket">
    {#each tr.bracket as slots, r (r)}
      <div class="round">
        <h3>{roundName(r + 1, tr.rounds)}</h3>
        {#each slots as s (s.slot)}
          <div class="match" class:mine={s.a?.you || s.b?.you}>
            {#each [['a', s.a], ['b', s.b]] as const as [k, p] (k)}
              <div class="player" class:won={s.winner === k} class:lost={s.winner !== null && s.winner !== k}>
                {#if p}<span class="name">{p.name}</span>{:else}<span class="muted">{t('tournament_bye')}</span>{/if}
              </div>
            {/each}
            {#if s.how && s.how !== 'bye'}<span class="how" title={t(`tournament_how_${s.how}`)}>{s.how === 'played' ? '⚔️' : '🤖'}</span>{/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/snippet}

<main>
  <header class="top">
    <h1>{t('tournament_title')}</h1>
  </header>
  {#if info}<p class="muted intro">{t('tournament_hint', { h: info.roundHours })}</p>{/if}
  {#if message}<p class="message" data-testid="message">{message}</p>{/if}

  {#if info?.current}
    {@const cur = info.current}
    <section class="panel highlight" data-testid="tournament-current">
      {#if cur.status === 'running'}
        <h2>{t('tournament_running', { r: roundName(cur.round, cur.rounds) })}</h2>
        <p class="muted small">{t('tournament_round_ends', { d: when(cur.roundEndsAt) })}</p>
        {#if cur.myMatch}
          <div class="versus">
            <MiniCard {ctx} defId={cur.myMatch.opponentLeader} onclick={() => (detail = cur.myMatch!.opponentLeader)} />
            <div>
              <p><strong>{t('tournament_my_match', { name: cur.myMatch.opponent })}</strong></p>
              <p class="muted small">{t('tournament_my_match_hint')}</p>
              <a class="btn btn-primary" href="/online?tournament=1" data-testid="tournament-play">{t('tournament_play')}</a>
            </div>
          </div>
        {:else if cur.registered}
          <p class="muted">{t('tournament_waiting')}</p>
        {/if}
      {:else if cur.status === 'done'}
        <h2>{t('tournament_done')}</h2>
        {#if cur.result}
          <p class="result" data-testid="tournament-result">
            {place(cur.result.top)} · +{cur.result.reward.coins} 🪙{cur.result.reward.freeBoosters ? ` · +${cur.result.reward.freeBoosters} 🎁` : ''}
          </p>
        {/if}
      {:else if cur.status === 'cancelled'}
        <h2>{t('tournament_cancelled')}</h2>
      {:else}
        <h2>{t('tournament_starting')}</h2>
      {/if}
      {#if cur.bracket.length}{@render bracket(cur)}{/if}
    </section>
  {/if}

  {#if info}
    {@const next = info.next}
    <section class="panel" data-testid="tournament-next">
      <h2>{t('tournament_next', { d: when(next.startsAt, true) })}</h2>
      <p class="muted small" data-testid="tournament-players">{t('tournament_players', { n: next.players })}</p>
      {#if next.registered}
        <div class="registered" data-testid="tournament-registered">
          <div class="leader"><MiniCard {ctx} defId={next.registered.leader} onclick={() => (detail = next.registered!.leader)} /></div>
          <p><strong>{t('tournament_registered')}</strong></p>
        </div>
      {/if}
      {#if decks.length}
        <label class="deck">
          <span>{t('tournament_deck')}</span>
          <select bind:value={deckId} data-testid="tournament-deck">
            {#each decks as d (d.id)}<option value={d.id}>{d.name} · {loc(ctx.cards[d.leaderId]?.name)}</option>{/each}
          </select>
        </label>
        <div class="actions">
          <button class="btn btn-primary" disabled={busy || !deckId} data-testid="tournament-register" onclick={() => call(() => api.tournamentRegister(deckId!), t('tournament_registered_msg'))}>
            {next.registered ? t('tournament_change_deck') : t('tournament_register')}
          </button>
          {#if next.registered}
            <button class="btn" disabled={busy} data-testid="tournament-unregister" onclick={() => call(() => api.tournamentUnregister(), t('tournament_unregistered_msg'))}>
              {t('tournament_unregister')}
            </button>
          {/if}
        </div>
      {:else}
        <p class="muted">{t('tournament_no_deck')} <a href="/decks">{t('decks')}</a></p>
      {/if}
    </section>

    <section class="panel">
      <h2>{t('tournament_rewards')}</h2>
      <ol class="rewards">
        {#each info.rewards as r (r.top)}
          <li>
            <span>{r.top === 0 ? t('tournament_participation') : place(r.top)}</span>
            <strong>{r.coins} 🪙{r.freeBoosters ? ` + ${r.freeBoosters} 🎁` : ''}</strong>
          </li>
        {/each}
      </ol>
      <p class="muted small">{t('tournament_title_reward')}</p>
    </section>
  {/if}
</main>

{#if detail}
  <div class="sheet-backdrop" role="presentation" onclick={() => (detail = null)}>
    <div class="sheet" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (detail = null)}>
      <CardInfo {ctx} defId={detail} />
      <button class="btn close" onclick={() => (detail = null)}>{t('close')}</button>
    </div>
  </div>
{/if}

<style>
  main {
    max-width: 860px;
    margin: 0 auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 40px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    margin: 0;
    flex: 1;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 20px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .intro {
    margin-top: 10px;
  }
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .highlight {
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
  .message {
    margin: 12px 0 0;
    font-weight: 700;
  }
  .versus {
    display: grid;
    grid-template-columns: 100px minmax(0, 1fr);
    gap: 14px;
    align-items: center;
    margin-top: 12px;
  }
  .versus p {
    margin: 0 0 8px;
  }
  .result {
    font-size: 20px;
    font-weight: 800;
    margin: 0 0 12px;
  }
  .bracket {
    display: flex;
    gap: 14px;
    overflow-x: auto;
    margin-top: 14px;
    padding-bottom: 6px;
  }
  .round {
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    gap: 10px;
    min-width: 150px;
  }
  .match {
    position: relative;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    overflow: hidden;
  }
  .match.mine {
    border-color: var(--accent);
  }
  .player {
    padding: 6px 28px 6px 10px;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .player + .player {
    border-top: 1px solid var(--line);
  }
  .player.won {
    font-weight: 800;
  }
  .player.lost {
    opacity: 0.5;
  }
  .how {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 14px;
  }
  .registered {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 10px 0;
  }
  .leader {
    width: 80px;
  }
  .deck {
    display: grid;
    gap: 6px;
    margin-top: 10px;
    font-size: 14px;
  }
  select {
    padding: 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: inherit;
    font: inherit;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 12px;
  }
  .rewards {
    list-style: none;
    padding: 0;
    margin: 0 0 10px;
  }
  .rewards li {
    display: flex;
    justify-content: space-between;
    padding: 8px 6px;
    border-top: 1px solid var(--line);
  }
  .close {
    margin-top: 16px;
    width: 100%;
  }
</style>
