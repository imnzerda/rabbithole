<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { CATEGORY_NAMES } from '@rabbithole/engine';
  import type { DeckDto, QueueMode } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api } from '$lib/api';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { loc, locale, t } from '$lib/i18n';
  import { Lobby, type LobbyState } from '$lib/match/online';
  import { loadSession, session } from '$lib/session.svelte';
  import Game from '$lib/ui/Game.svelte';

  let { data } = $props();
  // Le catalogue est lu une fois : il ne change pas pendant la vie de la page.
  const { ctx, version } = untrack(() => data.catalog);
  let lobby: Lobby | null = null;
  let lobbyState = $state.raw<LobbyState>({ kind: 'connecting' });
  let decks = $state.raw<DeckDto[]>([]);
  // Rang actuel (classé), affiché sur le bouton de la file classée.
  let rank = $state<{ id: string; points: number } | null>(null);
  let deckId = $state<string | null>(null);
  let now = $state(Date.now());

  const MODES: QueueMode[] = ['casual', 'ranked', 'ghost'];
  // Venu de la page Défi du jour ou Draft : la partie démarre (ou la file draft) dès la connexion,
  // et la fin de partie ramène à cette page.
  const params = untrack(() => page.url.searchParams);
  const SPECIAL = { daily: '/daily', draft: '/draft', tournament: '/tournaments' } as const;
  type Special = keyof typeof SPECIAL;
  let specialPending = $state<Special | null>((Object.keys(SPECIAL) as Special[]).find((k) => params.get(k) === '1') ?? null);
  let special = $state<Special | null>(null);
  const specialMatch = $derived(lobbyState.kind === 'playing' ? special : null);
  $effect(() => {
    if (specialPending && lobbyState.kind === 'idle' && lobby) {
      special = specialPending;
      specialPending = null;
      if (special === 'daily') lobby.daily();
      else if (special === 'draft') lobby.draft();
      else lobby.tournament();
    }
  });
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const ghostIn = $derived(lobbyState.kind === 'queued' && lobbyState.ghostAt ? Math.max(0, Math.ceil((lobbyState.ghostAt - now) / 1000)) : null);

  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 500);
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return;
      decks = (await api.decks()).decks;
      api
        .ranked()
        .then((r) => (rank = { id: r.rank, points: r.points }))
        .catch(() => {});
      deckId = decks[0]?.id ?? null;
      lobby = new Lobby(ctx, version, (next) => (lobbyState = next));
      lobby.connect();
    })();
    return () => {
      clearInterval(clock);
      lobby?.close();
    };
  });

  function queue(mode: QueueMode): void {
    if (lobby && deckId) lobby.queue(deckId, mode);
  }
</script>

{#if lobbyState.kind === 'playing'}
  <div class="screen">
    {#key lobbyState.match}
      <Game
        client={lobbyState.match}
        onexit={() => (specialMatch ? goto(SPECIAL[specialMatch]) : lobby?.leaveMatch())}
        onagain={specialMatch ? undefined : () => lobby?.leaveMatch()}
      />
    {/key}
  </div>
{:else}
  <main>
    <header>
      <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
      <h1>{t('online')}</h1>
    </header>

    {#if session.loaded && !session.user}
      <section class="panel">
        <p>{t('login_required')}</p>
        <div class="actions">
          <a class="btn" href="/login?next=/online">{t('login')}</a>
          <a class="btn btn-primary" href="/signup?next=/online">{t('signup')}</a>
        </div>
      </section>
    {:else if lobbyState.kind === 'connecting'}
      <p class="muted">{t('connecting')}</p>
    {:else if lobbyState.kind === 'queued'}
      <section class="panel searching" data-testid="searching">
        <div class="spinner" aria-hidden="true"></div>
        <p class="big">{t('searching')}</p>
        {#if ghostIn !== null && lobbyState.mode !== 'ghost'}<p class="muted">{t('ghost_in', { s: ghostIn })}</p>{/if}
        <button class="btn" onclick={() => lobby?.cancel()}>{t('cancel')}</button>
      </section>
    {:else}
      {#if lobbyState.kind === 'error'}<p class="error" role="alert">{lobbyState.message}</p>{/if}

      {#if decks.length === 0}
        <section class="panel" data-testid="no-deck">
          <p>{t('no_decks_lobby')}</p>
          <div class="actions">
            <a class="btn" href="/collection">{t('open_boosters')}</a>
            <a class="btn btn-primary" href="/decks">{t('build_deck')}</a>
          </div>
        </section>
      {/if}
      <h2>{t('my_decks')}</h2>
      <div class="decks" role="radiogroup" aria-label={t('my_decks')}>
        {#each decks as deck (deck.id)}
          {@const leader = ctx.cards[deck.leaderId]}
          <button class="deck" class:active={deckId === deck.id} role="radio" aria-checked={deckId === deck.id} onclick={() => (deckId = deck.id)}>
            <span class="deck-name">{deck.name}</span>
            <span class="deck-leader">{t('leader')} : {loc(leader?.name)}</span>
            <span class="chips">
              {#each leader?.categories ?? [] as c (c)}
                <span class="chip" style:--c={hex(CATEGORY_STYLE[c].color)}>{CATEGORY_STYLE[c].glyph} {CATEGORY_NAMES[c][locale]}</span>
              {/each}
            </span>
          </button>
        {/each}
      </div>

      <div class="modes">
        {#each MODES as mode (mode)}
          <button class="mode" class:primary={mode === 'casual'} disabled={!deckId} data-testid="mode-{mode}" onclick={() => queue(mode)}>
            <strong>{t(`mode_${mode}`)}</strong>
            <span>{t(`mode_${mode}_hint`)}</span>
            {#if mode === 'ranked' && rank}<span class="rank" data-testid="my-rank-badge">{t('rank_now', { r: t(`rank_${rank.id as 'lurker'}`), n: rank.points })}</span>{/if}
          </button>
        {/each}
      </div>
      <p class="links"><a href="/ranked">{t('ranked_title')}</a> · <a href="/replays">{t('history')}</a></p>
    {/if}
  </main>
{/if}

<style>
  .screen {
    height: 100dvh;
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 32px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
  }
  h2 {
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    margin: 24px 0 10px;
  }
  .icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    font-weight: 700;
  }
  .panel {
    margin-top: 24px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 20px;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .actions .btn,
  .btn {
    text-decoration: none;
    text-align: center;
  }
  .actions .btn {
    flex: 1;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: var(--lose);
    font-weight: 700;
  }
  .searching {
    display: grid;
    justify-items: center;
    gap: 10px;
    text-align: center;
  }
  .big {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
  }
  .spinner {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 4px solid var(--line);
    border-top-color: var(--accent);
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .decks {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  }
  .deck {
    text-align: left;
    padding: 14px 16px;
    border-radius: 16px;
    background: var(--bg-2);
    border: 2px solid var(--line);
    display: grid;
    gap: 6px;
  }
  .deck.active {
    border-color: var(--accent);
  }
  .deck-name {
    font-weight: 700;
    font-size: 17px;
  }
  .deck-leader {
    color: var(--accent);
    font-size: 14px;
    font-weight: 700;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font-size: 12px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 999px;
    color: var(--c);
    border: 1px solid var(--c);
  }
  .modes {
    margin-top: 20px;
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  }
  .mode {
    text-align: left;
    padding: 16px;
    border-radius: 16px;
    background: var(--panel);
    border: 1px solid var(--line);
    display: grid;
    gap: 4px;
  }
  .mode strong {
    font-size: 18px;
  }
  .mode .rank {
    color: var(--accent);
    font-weight: 700;
  }
  .mode span {
    color: var(--muted);
    font-size: 14px;
  }
  .mode.primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    border: 0;
  }
  .mode.primary span {
    color: rgb(255 255 255 / 0.85);
  }
  .links {
    text-align: center;
    margin-top: 20px;
  }
  .links a {
    color: var(--accent);
  }
</style>
