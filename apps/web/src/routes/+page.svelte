<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORY_NAMES, type CategoryId } from '@rabbithole/engine';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { loc, locale, t } from '$lib/i18n';
  import Notices from '$lib/ui/Notices.svelte';
  import RulesSheet from '$lib/ui/RulesSheet.svelte';
  import { loadSession, logout, session } from '$lib/session.svelte';
  import { onMount, untrack } from 'svelte';

  onMount(() => {
    if (!session.loaded) void loadSession();
  });

  let { data } = $props();
  // Decks d'entraînement lus une fois (série publiée, sinon prototype).
  const { ctx, decks } = untrack(() => data.practice);
  let selected = $state(decks[0]?.id ?? '');
  let showRules = $state(false);

  /** Catégories dominantes d'un deck, pour l'aperçu. */
  function categoriesOf(cards: string[]): CategoryId[] {
    const count = new Map<CategoryId, number>();
    for (const id of cards) for (const c of ctx.cards[id]?.categories ?? []) count.set(c, (count.get(c) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
  }
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
</script>

<main>
  <nav class="account" aria-label="Compte">
    {#if session.user}
      <span class="hello">{t('hello_user', { name: session.user.displayName })}</span>
      <a href="/collection" data-testid="nav-collection">{t('collection')}</a>
      <a href="/decks">{t('decks')}</a>
      <a href="/friends" data-testid="nav-friends">{t('friends')}</a>
      <a href="/trades" data-testid="nav-trades">{t('trades')}</a>
      <a href="/shop" data-testid="nav-shop">{t('shop')}</a>
      <a href="/replays">{t('history')}</a>
      <a href="/settings" data-testid="nav-settings">{t('settings')}</a>
      <button class="link" onclick={() => logout()}>{t('logout')}</button>
    {:else if session.loaded}
      <a href="/login">{t('login')}</a>
      <a class="strong" href="/signup">{t('signup')}</a>
    {/if}
  </nav>
  {#if session.user}<Notices />{/if}
  <header>
    <div class="logo" aria-hidden="true">
      <span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>
      <span class="rabbit">🐇</span>
    </div>
    <h1>RABBIT HOLE</h1>
    <p class="tagline">{t('tagline')}</p>
  </header>

  <div class="online">
    <button class="btn btn-primary cta" data-testid="online" onclick={() => goto('/online')}>{t('online')}</button>
  </div>

  <section>
    <h2>{t('practice')}</h2>
    <p class="hint">{t('practice_hint')} {t('choose_deck')} :</p>
    <div class="decks" role="radiogroup" aria-label={t('choose_deck')}>
      {#each decks as deck (deck.id)}
        <button
          class="deck"
          class:active={selected === deck.id}
          role="radio"
          aria-checked={selected === deck.id}
          data-testid="deck-{deck.id}"
          onclick={() => (selected = deck.id)}
        >
          <span class="deck-name">{loc(deck.name)}</span>
          <span class="deck-leader">{t('leader')} : {loc(ctx.cards[deck.leader]?.name)} · ❤ {ctx.cards[deck.leader]?.life}</span>
          <span class="deck-desc">{loc(deck.description)}</span>
          <span class="chips">
            {#each categoriesOf(deck.cards) as c (c)}
              <span class="chip" style:--c={hex(CATEGORY_STYLE[c].color)}>{CATEGORY_STYLE[c].glyph} {CATEGORY_NAMES[c][locale]}</span>
            {/each}
          </span>
        </button>
      {/each}
    </div>
  </section>

  <div class="actions">
    <button class="btn" onclick={() => (showRules = true)}>{t('rules')}</button>
    <button class="btn play" data-testid="play" onclick={() => goto(`/play?deck=${selected}`)}>{t('practice')}</button>
  </div>
  <footer class="legal"><a href="/credits">{t('credits')}</a> · <a href="/takedown">{t('takedown')}</a></footer>
</main>

{#if showRules}
  <RulesSheet rules={ctx.rules} onclose={() => (showRules = false)} />
{/if}

<style>
  .legal {
    margin-top: 28px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .legal a {
    color: var(--muted);
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: max(24px, env(safe-area-inset-top)) 16px 32px;
  }
  header {
    text-align: center;
    margin-bottom: 24px;
  }
  .account {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 14px;
    min-height: 24px;
    font-size: 14px;
  }
  .account a,
  .account .link {
    color: var(--muted);
    text-decoration: none;
    background: none;
    padding: 0;
  }
  .account .strong {
    color: var(--accent);
    font-weight: 700;
  }
  .hello {
    font-weight: 700;
  }
  .online {
    display: flex;
    justify-content: center;
    margin-bottom: 8px;
  }
  .cta {
    width: min(520px, 100%);
    font-size: 20px;
    padding: 16px;
  }
  .hint {
    color: var(--muted);
    margin: -4px 0 12px;
  }
  .logo {
    position: relative;
    width: 120px;
    height: 120px;
    margin: 0 auto 8px;
    display: grid;
    place-items: center;
  }
  .ring {
    position: absolute;
    border-radius: 50%;
    border: 3px solid var(--accent);
    animation: spin 9s linear infinite;
  }
  .r1 {
    inset: 0;
    opacity: 0.25;
  }
  .r2 {
    inset: 16px 12px 20px 18px;
    opacity: 0.5;
    border-color: var(--accent-2);
    animation-duration: 6s;
  }
  .r3 {
    inset: 34px 30px 38px 34px;
    opacity: 0.85;
    animation-duration: 4s;
  }
  .rabbit {
    font-size: 34px;
    position: relative;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  h1 {
    margin: 0;
    font-size: 40px;
    letter-spacing: 0.08em;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tagline {
    margin: 4px 0 0;
    color: var(--muted);
    font-style: italic;
  }
  h2 {
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
  }
  .decks {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  }
  .deck {
    text-align: left;
    padding: 14px 16px;
    border-radius: 16px;
    background: var(--bg-2);
    border: 2px solid var(--line);
    display: grid;
    gap: 6px;
    transition: border-color 0.15s, transform 0.15s;
  }
  .deck.active {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .deck-name {
    font-weight: 700;
    font-size: 18px;
  }
  .deck-leader {
    color: var(--accent);
    font-weight: 700;
    font-size: 14px;
  }
  .deck-desc {
    color: var(--muted);
    font-size: 14px;
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
  .actions {
    display: flex;
    gap: 10px;
    margin: 24px auto 0;
    max-width: 520px;
  }
  .actions .play {
    flex: 1;
    font-size: 18px;
    padding: 14px;
  }
</style>
