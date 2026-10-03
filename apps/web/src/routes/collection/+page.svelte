<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORIES, CATEGORY_NAMES, RARITIES, type CardDef, type CategoryId, type Rarity } from '@rabbithole/engine';
  import type { BoostersResponse, TradeUpOfferDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { loc, locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';
  import { pickSpares, sparesOf } from '$lib/tradeup';

  let { data } = $props();
  // Le catalogue est lu une fois : il ne change pas pendant la vie de la page.
  const { ctx, collectible, blocked } = untrack(() => data.catalog);
  // Cartes bloquées dans le pays du joueur : absentes de la collection (section 9).
  const inCollection = (c: CardDef) => collectible.has(c.id) && !blocked.has(c.id);
  const leaders = Object.values(ctx.cards).filter((c) => inCollection(c) && c.type === 'leader');
  const cards = Object.values(ctx.cards)
    .filter((c) => inCollection(c) && c.type !== 'leader')
    .sort((a, b) => CATEGORIES.indexOf(a.categories[0]!) - CATEGORIES.indexOf(b.categories[0]!) || a.cost - b.cost);

  let shop = $state.raw<BoostersResponse | null>(null);
  let owned = $state.raw(new Map<string, number>());
  let filter = $state<'all' | 'owned' | CategoryId>('all');
  let opened = $state.raw<{ title: string; cards: string[]; fresh: Set<string> } | null>(null);
  let detail = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let now = $state(Date.now());

  const wallet = $derived(shop?.wallet ?? null);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const keepFor = (def: CardDef) => (def.type === 'leader' ? 1 : (shop?.economy.keepCopies ?? 2));
  const visible = $derived(
    [...leaders, ...cards].filter((c) => (filter === 'all' ? true : filter === 'owned' ? (owned.get(c.id) ?? 0) > 0 : c.categories.includes(filter))),
  );
  const ownedTotal = $derived([...owned.values()].reduce((a, b) => a + b, 0));

  // Trade-up (section 6.4) : rareté et catégorie choisies, cartes possibles affichées avant l'échange.
  const TRADE_RARITIES = RARITIES.slice(0, -1);
  let tuRarity = $state<Rarity>('basique');
  let tuCategory = $state<CategoryId | null>(null);
  let tuOffer = $state.raw<TradeUpOfferDto | null>(null);
  const spares = $derived(sparesOf(tuRarity, [...leaders, ...cards], owned, keepFor));
  const spareCount = (r: Rarity) => sparesOf(r, [...leaders, ...cards], owned, keepFor).reduce((a, s) => a + s.spare, 0);
  const tuRequired = $derived(shop ? (tuCategory ? shop.economy.tradeUp.targetedCount : shop.economy.tradeUp.count) : 0);
  const tuGive = $derived(tuRequired ? pickSpares(spares, tuRequired) : null);
  $effect(() => {
    const [rarity, category, ready] = [tuRarity, tuCategory, !!shop];
    void owned;
    if (!ready) return;
    api
      .tradeUpOffer(rarity, category)
      .then((r) => (tuOffer = r.offer))
      .catch(() => (tuOffer = null));
  });

  async function refresh(): Promise<void> {
    const [b, c] = await Promise.all([api.boosters(), api.collection()]);
    shop = b;
    owned = new Map(c.cards.map((x) => [x.cardId, x.quantity]));
  }

  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 1000);
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/collection');
      await refresh();
    })();
    return () => clearInterval(clock);
  });

  function errorText(e: unknown): string {
    if (!(e instanceof ApiError)) return t('err_generic');
    const known = ['not_enough_coins', 'preview_changed', 'not_enough_essence', 'not_enough_duplicates', 'wrong_count', 'mixed_rarities'] as const;
    const code = known.find((k) => k === e.code);
    return code ? t(`err_${code}`) : t('err_generic');
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    busy = true;
    message = null;
    try {
      await fn();
    } catch (e) {
      message = errorText(e);
      await refresh();
    } finally {
      busy = false;
    }
  }

  const reveal = (received: string[], before: Map<string, number>, title = t('opened_title')) => {
    opened = { title, cards: received, fresh: new Set(received.filter((id) => !before.get(id))) };
  };

  const openFree = (type: string) =>
    run(async () => {
      const before = owned;
      reveal((await api.openFree(type)).cards, before);
      await refresh();
    });

  const buy = (type: string, cardIds: string[]) =>
    run(async () => {
      const before = owned;
      reveal((await api.purchase(type, cardIds)).cards, before);
      await refresh();
    });

  const doTradeUp = (give: { cardId: string; count: number }[]) =>
    run(async () => {
      const before = owned;
      reveal([(await api.tradeUp(give, tuCategory)).card], before, t('tradeup_result'));
      await refresh();
    });

  const chooseLeader = (id: string) =>
    run(async () => {
      await api.starterLeader(id);
      if (session.user) session.user = { ...session.user, starterLeader: id };
      await refresh();
    });

  const recycle = (id: string) =>
    run(async () => {
      await api.recycle(id, 1);
      await refresh();
    });

  const craft = (id: string) =>
    run(async () => {
      await api.craft(id);
      await refresh();
    });

  function countdown(iso: string): string {
    const ms = Math.max(0, Date.parse(iso) - now);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s).padStart(2, '0')} s`;
  }
</script>

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('collection')}</h1>
    {#if wallet}
      <div class="wallet" data-testid="wallet">
        <span title={t('coins')}>🪙 {wallet.coins}</span>
        <span title={t('gems')}>💎 {wallet.gems}</span>
        <span title={t('essence')}>✨ {wallet.essence}</span>
        <span title={t('free_boosters')}>🎁 {wallet.freeBoosters}</span>
      </div>
    {/if}
  </header>
  <nav class="tabs"><a href="/decks">{t('decks')} →</a></nav>

  {#if message}<p class="error" role="alert">{message}</p>{/if}

  {#if session.user && !session.user.starterLeader && shop}
    <section class="panel starter" data-testid="starter">
      <h2>{t('starter_title')}</h2>
      <p class="muted">{t('starter_hint')}</p>
      <div class="leaders">
        {#each leaders as leader (leader.id)}
          <div class="leader">
            <MiniCard {ctx} defId={leader.id} onclick={() => (detail = leader.id)} />
            <span class="chips">
              {#each leader.categories as c (c)}<span class="chip" style:--c={hex(CATEGORY_STYLE[c].color)}>{CATEGORY_STYLE[c].glyph} {CATEGORY_NAMES[c][locale]}</span>{/each}
            </span>
            <button class="btn btn-primary" disabled={busy} data-testid="choose-{leader.id}" onclick={() => chooseLeader(leader.id)}>{t('choose')}</button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if shop}
    {#each shop.types as booster (booster.type)}
      <section class="panel booster">
        <div class="booster-head">
          <h2>{loc(booster.name)}</h2>
          <span class="muted">{t('next_preview', { t: countdown(booster.preview.refreshAt) })}</span>
        </div>
        <p class="muted">{t('preview_hint')}</p>
        <div class="preview" data-testid="preview">
          {#each booster.preview.cardIds as id, i (i)}
            <MiniCard {ctx} defId={id} fresh={!owned.get(id)} onclick={() => (detail = id)} />
          {/each}
        </div>
        <div class="actions">
          <button class="btn btn-primary" disabled={busy || (wallet?.coins ?? 0) < booster.price} data-testid="buy" onclick={() => buy(booster.type, booster.preview.cardIds)}>
            {t('buy', { n: booster.price })}
          </button>
          <button class="btn gift" disabled={busy || !wallet?.freeBoosters} data-testid="open-free" onclick={() => openFree(booster.type)}>
            🎁 {t('open_free', { n: wallet?.freeBoosters ?? 0 })}
          </button>
        </div>
        <p class="muted small">{t('earn_hint')}</p>
        <details>
          <summary>{t('odds')}</summary>
          <ul class="odds">
            {#each Object.entries(booster.odds) as [rarity, pct] (rarity)}
              <li>{t(`rarity_${rarity as 'basique'}`)} <strong>{pct} %</strong></li>
            {/each}
          </ul>
        </details>
      </section>
    {/each}

    <section class="panel tradeup" data-testid="tradeup">
      <h2>{t('tradeup_title')}</h2>
      <p class="muted">{t('tradeup_hint', { n: shop.economy.tradeUp.count })}</p>
      <div class="filters" role="tablist">
        {#each TRADE_RARITIES as r (r)}
          <button class:on={tuRarity === r} data-testid="tu-{r}" onclick={() => (tuRarity = r)}>
            {t(`rarity_${r}`)} · {t('tradeup_spares', { n: spareCount(r) })}
          </button>
        {/each}
      </div>
      <div class="filters">
        <button class:on={tuCategory === null} onclick={() => (tuCategory = null)}>🎲 {t('tradeup_random', { n: shop.economy.tradeUp.count })}</button>
        <select
          aria-label={t('tradeup_targeted', { n: shop.economy.tradeUp.targetedCount })}
          value={tuCategory ?? ''}
          onchange={(e) => (tuCategory = ((e.currentTarget as HTMLSelectElement).value || null) as CategoryId | null)}
        >
          <option value="">🎯 {t('tradeup_targeted', { n: shop.economy.tradeUp.targetedCount })}</option>
          {#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_STYLE[c].glyph} {CATEGORY_NAMES[c][locale]}</option>{/each}
        </select>
      </div>
      {#if tuOffer}
        <p class="muted small" data-testid="tu-odds">
          → {t(`rarity_${tuOffer.outputRarity as Rarity}`)} : {t('tradeup_pool', { n: tuOffer.pool.length, p: tuOffer.chance })}
          {#if tuOffer.unownedOnly}<br />{t('tradeup_unowned')}{/if}
        </p>
        <details>
          <summary>{t('tradeup_see_pool')}</summary>
          <div class="grid small-grid">
            {#each tuOffer.pool as id (id)}<MiniCard {ctx} defId={id} fresh={!owned.get(id)} onclick={() => (detail = id)} />{/each}
          </div>
        </details>
      {/if}
      {#if tuGive}
        <p class="muted small">{t('tradeup_give')} :</p>
        <div class="grid small-grid">
          {#each tuGive as g (g.cardId)}<MiniCard {ctx} defId={g.cardId} count={g.count} onclick={() => (detail = g.cardId)} />{/each}
        </div>
      {:else}
        <p class="muted small">{t('tradeup_missing', { n: tuRequired - spares.reduce((a, s) => a + s.spare, 0), r: t(`rarity_${tuRarity}`) })}</p>
      {/if}
      <div class="actions">
        <button class="btn btn-primary" disabled={busy || !tuGive || !tuOffer} data-testid="tu-go" onclick={() => tuGive && doTradeUp(tuGive)}>
          {t('tradeup_btn', { n: tuRequired })}
        </button>
      </div>
    </section>

    <section>
      <div class="filters" role="tablist">
        <button class:on={filter === 'all'} onclick={() => (filter = 'all')}>{t('filter_all')}</button>
        <button class:on={filter === 'owned'} onclick={() => (filter = 'owned')}>{t('filter_owned')} ({ownedTotal})</button>
        {#each CATEGORIES as c (c)}
          <button class:on={filter === c} style:--c={hex(CATEGORY_STYLE[c].color)} onclick={() => (filter = c)}>{CATEGORY_STYLE[c].glyph} {CATEGORY_NAMES[c][locale]}</button>
        {/each}
      </div>
      <div class="grid" data-testid="collection">
        {#each visible as card (card.id)}
          <MiniCard {ctx} defId={card.id} count={owned.get(card.id) ?? 0} onclick={() => (detail = card.id)} />
        {/each}
      </div>
    </section>
  {/if}
</main>

{#if opened}
  <div class="sheet-backdrop" role="presentation" onclick={() => (opened = null)}>
    <div class="sheet reveal" role="dialog" aria-modal="true" aria-label={opened.title} tabindex="-1" data-testid="opened" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (opened = null)}>
      <h2>{opened.title}</h2>
      <div class="opened">
        {#each opened.cards as id, i (i)}
          <div class="flip" style:animation-delay="{i * 180}ms"><MiniCard {ctx} defId={id} fresh={opened.fresh.has(id)} /></div>
        {/each}
      </div>
      <button class="btn btn-primary close" onclick={() => (opened = null)}>{t('close')}</button>
    </div>
  </div>
{/if}

{#if detail}
  {@const def = ctx.cards[detail]}
  {@const count = owned.get(detail) ?? 0}
  {#if def && shop}
    <div class="sheet-backdrop" role="presentation" onclick={() => (detail = null)}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={loc(def.name)} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (detail = null)}>
        <CardInfo {ctx} defId={detail} />
        <p class="owned">{t('owned_count', { n: count })}</p>
        <div class="actions">
          <button class="btn" disabled={busy || count <= keepFor(def)} onclick={() => recycle(def.id)}>{t('recycle_btn', { n: shop.economy.recycle[def.rarity] ?? 0 })}</button>
          <button class="btn btn-primary" disabled={busy || count >= keepFor(def) || (wallet?.essence ?? 0) < (shop.economy.craft[def.rarity] ?? Infinity)} onclick={() => craft(def.id)}>
            {t('craft_btn', { n: shop.economy.craft[def.rarity] ?? 0 })}
          </button>
        </div>
        {#if message}<p class="error">{message}</p>{/if}
        <button class="btn close" onclick={() => (detail = null)}>{t('close')}</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 40px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  h1 {
    margin: 0;
    flex: 1;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 20px;
  }
  .icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    font-weight: 700;
  }
  .wallet {
    display: flex;
    gap: 10px;
    font-weight: 700;
  }
  .wallet span {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 6px 12px;
  }
  .tabs {
    text-align: right;
    margin: 6px 0 0;
  }
  .tabs a {
    color: var(--accent);
    font-weight: 700;
  }
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .starter {
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    margin: 0 0 10px;
  }
  .small {
    font-size: 13px;
    margin-top: 8px;
  }
  .error {
    color: var(--lose);
    font-weight: 700;
  }
  .leaders {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .leader {
    display: grid;
    gap: 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 999px;
    color: var(--c);
    border: 1px solid var(--c);
  }
  .booster-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .preview,
  .opened {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .preview {
    max-width: 720px;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  .actions .btn {
    flex: 1 1 200px;
  }
  .gift {
    color: var(--win);
    border-color: var(--win);
  }
  details summary {
    cursor: pointer;
    color: var(--muted);
    margin-top: 8px;
  }
  .odds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    padding: 0;
    list-style: none;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 24px 0 12px;
  }
  .filters button {
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--c, var(--line));
    color: var(--c, var(--text));
    font-size: 13px;
    font-weight: 700;
  }
  .filters button.on {
    background: color-mix(in srgb, var(--c, var(--accent)) 30%, var(--panel));
    color: var(--text);
  }
  .grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }
  .small-grid {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    max-width: 720px;
    margin-top: 8px;
  }
  .tradeup .filters {
    margin: 8px 0;
  }
  .tradeup select {
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 13px;
    font-weight: 700;
  }
  .reveal {
    width: min(760px, 100%);
  }
  .flip {
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
  @media (max-width: 520px) {
    .preview,
    .opened {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
