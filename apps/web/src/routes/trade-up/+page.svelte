<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORIES, CATEGORY_NAMES, RARITIES, type CardDef, type CategoryId, type Rarity } from '@rabbithole/engine';
  import type { BoostersResponse, TradeUpOfferDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { loc, locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import { completeSpares, sparesOf, toggleSpare } from '$lib/tradeup';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  /**
   * Trade-up (section 6.4) : des doublons de même rareté contre une carte de la rareté supérieure,
   * tirée par le serveur. Les cartes possibles et leur probabilité sont affichées avant l'échange.
   */
  let { data } = $props();
  const { ctx, collectible, blocked } = untrack(() => data.catalog);
  const defs = Object.values(ctx.cards).filter((c) => collectible.has(c.id) && !blocked.has(c.id));

  let shop = $state.raw<BoostersResponse | null>(null);
  let owned = $state.raw(new Map<string, number>());
  let opened = $state.raw<{ card: string; fresh: boolean } | null>(null);
  let detail = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);

  const keepFor = (def: CardDef) => (def.type === 'leader' ? 1 : (shop?.economy.keepCopies ?? 2));
  const TRADE_RARITIES = RARITIES.slice(0, -1);
  let rarity = $state<Rarity>('basique');
  let category = $state<CategoryId | null>(null);
  let offer = $state.raw<TradeUpOfferDto | null>(null);
  const spares = $derived(sparesOf(rarity, defs, owned, keepFor));
  const spareCount = (r: Rarity) => sparesOf(r, defs, owned, keepFor).reduce((a, s) => a + s.spare, 0);
  const required = $derived(shop ? (category ? shop.economy.tradeUp.targetedCount : shop.economy.tradeUp.count) : 0);
  // Doublons choisis par le joueur (vidés au changement de rareté) ; le bouton exige le nombre exact.
  let picked = $state.raw(new Map<string, number>());
  const pickedCount = $derived([...picked.values()].reduce((a, b) => a + b, 0));
  const give = $derived(required && pickedCount === required ? [...picked].map(([cardId, count]) => ({ cardId, count })) : null);
  const spareTotal = $derived(spares.reduce((a, s) => a + s.spare, 0));
  const chooseRarity = (r: Rarity) => {
    rarity = r;
    picked = new Map();
  };

  $effect(() => {
    const [r, c, ready] = [rarity, category, !!shop];
    void owned;
    if (!ready) return;
    api
      .tradeUpOffer(r, c)
      .then((res) => (offer = res.offer))
      .catch(() => (offer = null));
  });

  async function refresh(): Promise<void> {
    const [b, c] = await Promise.all([api.boosters(), api.collection()]);
    shop = b;
    owned = new Map(c.cards.map((x) => [x.cardId, x.quantity]));
  }

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/trade-up');
      await refresh();
    })();
  });

  async function tradeUp(items: { cardId: string; count: number }[]): Promise<void> {
    busy = true;
    message = null;
    try {
      const before = owned;
      const { card } = await api.tradeUp(items, category);
      opened = { card, fresh: !before.get(card) };
      picked = new Map();
    } catch (e) {
      const known = ['not_enough_duplicates', 'wrong_count', 'mixed_rarities'] as const;
      const code = e instanceof ApiError ? known.find((k) => k === e.code) : undefined;
      message = code ? t(`err_${code}`) : t('err_generic');
    } finally {
      busy = false;
      await refresh();
    }
  }
</script>

<main>
  <header class="top">
    <h1>{t('tradeup_title')}</h1>
  </header>

  {#if message}<p class="error" role="alert">{message}</p>{/if}

  {#if shop}
    <section class="panel" data-testid="tradeup">
      <p class="muted">{t('tradeup_hint', { n: shop.economy.tradeUp.count })}</p>
      <h2>1. {t('tradeup_pick_rarity')}</h2>
      <div class="filters" role="tablist">
        {#each TRADE_RARITIES as r (r)}
          <button class:on={rarity === r} data-testid="tu-{r}" onclick={() => chooseRarity(r)}>
            {t(`rarity_${r}`)} · {t('tradeup_spares', { n: spareCount(r) })}
          </button>
        {/each}
      </div>
      <h2>2. {t('tradeup_pick_mode')}</h2>
      <div class="filters">
        <button class:on={category === null} onclick={() => (category = null)}>🎲 {t('tradeup_random', { n: shop.economy.tradeUp.count })}</button>
        <select
          class:on={category !== null}
          aria-label={t('tradeup_targeted', { n: shop.economy.tradeUp.targetedCount })}
          value={category ?? ''}
          onchange={(e) => (category = ((e.currentTarget as HTMLSelectElement).value || null) as CategoryId | null)}
        >
          <option value="">🎯 {t('tradeup_targeted', { n: shop.economy.tradeUp.targetedCount })}</option>
          {#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_STYLE[c].glyph} {CATEGORY_NAMES[c][locale]}</option>{/each}
        </select>
      </div>
    </section>

    {#if offer}
      <section class="panel">
        <h2>{t('tradeup_odds_title')}</h2>
        <p class="muted" data-testid="tu-odds">
          → {t(`rarity_${offer.outputRarity as Rarity}`)} : {t('tradeup_pool', { n: offer.pool.length, p: offer.chance })}
          {#if offer.unownedOnly}<br />{t('tradeup_unowned')}{/if}
        </p>
        <details>
          <summary>{t('tradeup_see_pool')}</summary>
          <div class="grid">
            {#each offer.pool as id (id)}<MiniCard {ctx} defId={id} fresh={!owned.get(id)} onclick={() => (detail = id)} />{/each}
          </div>
        </details>
      </section>
    {/if}

    <section class="panel highlight">
      <div class="give-head">
        <h2>{t('tradeup_give')}</h2>
        <span class="count" class:ok={pickedCount === required} class:over={pickedCount > required} data-testid="tu-count">{pickedCount} / {required}</span>
      </div>
      {#if spareTotal < required}
        <p class="muted">{t('tradeup_missing', { n: required - spareTotal, r: t(`rarity_${rarity}`) })}</p>
      {:else}
        <p class="muted">{t('tradeup_pick_hint')}</p>
        <div class="tools">
          <button class="btn" disabled={pickedCount >= required} data-testid="tu-complete" onclick={() => (picked = completeSpares(spares, picked, required))}>{t('tradeup_complete')}</button>
          <button class="btn" disabled={pickedCount === 0} onclick={() => (picked = new Map())}>{t('tradeup_clear')}</button>
          <button class="btn btn-primary" disabled={busy || !give || !offer} data-testid="tu-go-top" onclick={() => give && tradeUp(give)}>
            {t('tradeup_btn', { n: required })}
          </button>
        </div>
      {/if}
      <div class="grid" data-testid="tu-spares">
        {#each spares as s (s.cardId)}
          <div class="pick" class:on={picked.has(s.cardId)}>
            <MiniCard {ctx} defId={s.cardId} count={s.spare} onclick={() => (picked = toggleSpare(picked, s))} />
            {#if picked.has(s.cardId)}<span class="picked">+{picked.get(s.cardId)}</span>{/if}
          </div>
        {/each}
      </div>
      <div class="actions">
        <button class="btn btn-primary" disabled={busy || !give || !offer} data-testid="tu-go" onclick={() => give && tradeUp(give)}>
          {t('tradeup_btn', { n: required })}
        </button>
      </div>
    </section>
  {/if}
</main>

{#if opened}
  <div class="sheet-backdrop" role="presentation" onclick={() => (opened = null)}>
    <div class="sheet reveal" role="dialog" aria-modal="true" aria-label={t('tradeup_result')} tabindex="-1" data-testid="opened" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (opened = null)}>
      <h2>{t('tradeup_result')}</h2>
      <div class="flip"><MiniCard {ctx} defId={opened.card} fresh={opened.fresh} /></div>
      <button class="btn btn-primary close" onclick={() => (opened = null)}>{t('close')}</button>
    </div>
  </div>
{/if}

{#if detail}
  {@const def = ctx.cards[detail]}
  {#if def}
    <div class="sheet-backdrop" role="presentation" onclick={() => (detail = null)}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={loc(def.name)} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (detail = null)}>
        <CardInfo {ctx} defId={detail} />
        <p class="owned">{t('owned_count', { n: owned.get(detail) ?? 0 })}</p>
        <button class="btn close" onclick={() => (detail = null)}>{t('close')}</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  main {
    max-width: 900px;
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
    margin: 14px 0 6px;
    font-size: 18px;
  }
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .panel > h2:first-child {
    margin-top: 0;
  }
  .highlight {
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    margin: 0 0 10px;
  }
  .error {
    color: var(--lose);
    font-weight: 700;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0;
  }
  .filters button,
  .filters select {
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 13px;
    font-weight: 700;
  }
  .filters .on {
    background: color-mix(in srgb, var(--accent) 30%, var(--panel));
  }
  .grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    margin-top: 8px;
  }
  .give-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .give-head h2 {
    margin: 0 0 6px;
  }
  .count {
    font-weight: 800;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
  }
  .count.ok {
    color: var(--win);
    border-color: var(--win);
  }
  .count.over {
    color: var(--lose);
    border-color: var(--lose);
  }
  .tools {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
  }
  .tools .btn {
    padding: 8px 12px;
    font-size: 14px;
    white-space: nowrap;
  }
  .tools .btn-primary {
    flex: 1;
  }
  .pick {
    position: relative;
    border-radius: 12px;
    outline: 3px solid transparent;
  }
  .pick.on {
    outline-color: var(--accent);
  }
  .picked {
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent);
    color: #fff;
    font-weight: 800;
    font-size: 13px;
    border-radius: 999px;
    padding: 2px 8px;
    pointer-events: none;
  }
  details summary {
    cursor: pointer;
    color: var(--muted);
  }
  .actions {
    display: flex;
    margin-top: 14px;
  }
  .actions .btn {
    flex: 1;
  }
  .reveal {
    width: min(360px, 100%);
    text-align: center;
  }
  .flip {
    width: 160px;
    margin: 12px auto;
    animation: flip 0.45s ease-out both;
  }
  @keyframes flip {
    from {
      transform: rotateY(90deg) scale(0.8);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  .owned {
    font-weight: 700;
    margin: 14px 0 0;
  }
  .close {
    margin-top: 16px;
    width: 100%;
  }
</style>
