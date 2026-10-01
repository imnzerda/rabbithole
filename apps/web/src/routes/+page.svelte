<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORY_NAMES, type CategoryId } from '@rabbithole/engine';
  import { PROTOTYPE_DECKS, prototypeContext } from '@rabbithole/content';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { loc, locale, t } from '$lib/i18n';
  import RulesSheet from '$lib/ui/RulesSheet.svelte';

  const ctx = prototypeContext();
  let selected = $state(PROTOTYPE_DECKS[0]?.id ?? '');
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
  <header>
    <div class="logo" aria-hidden="true">
      <span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>
      <span class="rabbit">🐇</span>
    </div>
    <h1>RABBIT HOLE</h1>
    <p class="tagline">{t('tagline')}</p>
  </header>

  <section>
    <h2>{t('choose_deck')}</h2>
    <div class="decks" role="radiogroup" aria-label={t('choose_deck')}>
      {#each PROTOTYPE_DECKS as deck (deck.id)}
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
    <button class="btn btn-primary play" data-testid="play" onclick={() => goto(`/play?deck=${selected}`)}>{t('play')}</button>
  </div>
  <p class="opponent">{t('opponent_ai')}</p>
</main>

{#if showRules}
  <RulesSheet rules={ctx.rules} onclose={() => (showRules = false)} />
{/if}

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: max(24px, env(safe-area-inset-top)) 16px 32px;
  }
  header {
    text-align: center;
    margin-bottom: 24px;
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
  .opponent {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }
</style>
