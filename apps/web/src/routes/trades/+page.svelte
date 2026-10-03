<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { RARITIES, type CardDef } from '@rabbithole/engine';
  import type { FriendDto, TradeDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { loc, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  let { data } = $props();
  const { ctx, collectible, blocked } = untrack(() => data.catalog);
  /** Cartes échangeables vues par ce joueur (publiées, pas bloquées dans son pays). */
  const tradable = (id: string) => collectible.has(id) && !blocked.has(id);
  const rarityRank = (id: string) => RARITIES.indexOf(ctx.cards[id]!.rarity);

  type Trades = Awaited<ReturnType<typeof api.trades>>;
  let friends = $state.raw<FriendDto[] | null>(null);
  let trades = $state.raw<Trades | null>(null);
  let mine = $state.raw(new Map<string, number>());
  let message = $state<{ text: string; error: boolean } | null>(null);
  let busy = $state(false);
  let detail = $state<string | null>(null);
  let now = $state(Date.now());

  type Item = { cardId: string; quantity: number };
  /** Cartes échangeables, les plus rares d'abord. */
  const byRarity = (items: Item[]) => items.filter((c) => tradable(c.cardId)).sort((a, b) => rarityRank(b.cardId) - rarityRank(a.cardId) || a.cardId.localeCompare(b.cardId));

  // Proposition en cours : autant de cartes que voulu de chaque côté ; un côté vide = don (ou demande de don).
  let proposal = $state.raw<{ friend: FriendDto; theirs: Item[]; asked: Map<string, number>; given: Map<string, number> } | null>(null);
  let search = $state('');
  const matches = (id: string) => !search.trim() || loc(ctx.cards[id]!.name).toLowerCase().includes(search.trim().toLowerCase());
  const myItems = $derived(byRarity([...mine].map(([cardId, quantity]) => ({ cardId, quantity }))));
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  /** Un toucher ajoute un exemplaire ; au maximum, le suivant remet à zéro. */
  function tap(side: 'asked' | 'given', item: Item): void {
    if (!proposal) return;
    const next = new Map(proposal[side]);
    const n = (next.get(item.cardId) ?? 0) + 1;
    if (n > item.quantity) next.delete(item.cardId);
    else next.set(item.cardId, n);
    proposal = { ...proposal, [side]: next };
  }
  const items = (m: Map<string, number>) => [...m].map(([cardId, quantity]) => ({ cardId, quantity }));

  async function refresh(): Promise<void> {
    const [f, tr, c] = await Promise.all([api.friends(), api.trades(), api.collection()]);
    friends = f.friends;
    trades = tr;
    mine = new Map(c.cards.map((x) => [x.cardId, x.quantity]));
  }

  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 30_000);
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/trades');
      await refresh();
      // Venu de la page Amis (« Proposer un échange ») : la proposition s'ouvre directement.
      const target = friends?.find((f) => f.id === page.url.searchParams.get('with'));
      if (target) void openProposal(target);
    })();
    return () => clearInterval(clock);
  });

  const KNOWN_ERRORS = ['not_owned', 'not_owned_by_friend', 'trade_expired', 'trade_closed', 'not_friends', 'too_many_pending', 'empty_trade', 'same_card'] as const;

  async function run(fn: () => Promise<string | void>): Promise<void> {
    busy = true;
    message = null;
    try {
      const ok = await fn();
      if (ok) message = { text: ok, error: false };
    } catch (e) {
      const code = e instanceof ApiError ? KNOWN_ERRORS.find((k) => k === e.code) : undefined;
      message = { text: code ? t(`err_${code}`) : t('err_generic'), error: true };
    } finally {
      busy = false;
      await refresh().catch(() => {});
    }
  }

  const openProposal = (friend: FriendDto) =>
    run(async () => {
      const { cards } = await api.friendCollection(friend.id);
      search = '';
      proposal = { friend, theirs: byRarity(cards), asked: new Map(), given: new Map() };
    });

  const sendProposal = () =>
    run(async () => {
      if (!proposal || total(proposal.asked) + total(proposal.given) === 0) return;
      await api.proposeTrade(proposal.friend.id, items(proposal.given), items(proposal.asked));
      proposal = null;
      return t('trade_sent');
    });

  const act = (trade: TradeDto, action: 'accept' | 'decline' | 'cancel') =>
    run(async () => {
      await api.tradeAction(trade.id, action);
      if (action === 'accept') return t('trade_done');
    });

  /** Ce que je reçois et ce que je donne, vu de mon côté. */
  const sides = (trade: TradeDto) => {
    const sent = trade.fromUser.id === session.user?.id;
    return { other: sent ? trade.toUser.name : trade.fromUser.name, receive: sent ? trade.requested : trade.offered, give: sent ? trade.offered : trade.requested };
  };

  function countdown(iso: string): string {
    const ms = Math.max(0, Date.parse(iso) - now);
    const h = Math.floor(ms / 3_600_000);
    return h >= 1 ? `${h} h` : `${Math.ceil(ms / 60_000)} min`;
  }
</script>

{#snippet tradeRow(trade: TradeDto, actions: 'incoming' | 'outgoing' | 'history')}
  {@const s = sides(trade)}
  <div class="trade" data-testid="trade-{actions}">
    <p class="trade-head">
      <strong>{t('trade_with', { name: s.other })}</strong>
      {#if actions === 'history'}
        <span class="status status-{trade.status}">{t(`trade_status_${trade.status as 'accepted'}`)}</span>
      {:else}
        <span class="muted">{t('trade_expires', { t: countdown(trade.expiresAt) })}</span>
      {/if}
    </p>
    <div class="swap">
      {#each [{ label: t('trade_receive'), list: s.receive, fresh: true }, { label: t('trade_give'), list: s.give, fresh: false }] as side, i (i)}
        {#if i === 1}<span class="arrow" aria-hidden="true">⇄</span>{/if}
        <div class="side">
          <p class="caption">{side.label}</p>
          {#if side.list.length === 0}
            <p class="muted nothing">{t('trade_nothing')}</p>
          {:else}
            <div class="cards">
              {#each side.list as item (item.cardId)}
                <MiniCard {ctx} defId={item.cardId} count={item.quantity} fresh={side.fresh && !mine.get(item.cardId)} onclick={() => (detail = item.cardId)} />
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    {#if actions === 'incoming'}
      <div class="actions">
        <button class="btn btn-primary" disabled={busy} data-testid="trade-accept" onclick={() => act(trade, 'accept')}>{t('accept')}</button>
        <button class="btn" disabled={busy} onclick={() => act(trade, 'decline')}>{t('decline')}</button>
      </div>
    {:else if actions === 'outgoing'}
      <div class="actions">
        <button class="btn" disabled={busy} onclick={() => act(trade, 'cancel')}>{t('cancel')}</button>
      </div>
    {/if}
  </div>
{/snippet}

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('trades')}</h1>
  </header>
  <nav class="tabs"><a href="/friends">{t('friends')} →</a></nav>

  {#if message}<p class:error={message.error} class:ok={!message.error} role="status" data-testid="message">{message.text}</p>{/if}

  {#if friends && trades}
    <section class="panel" class:highlight={trades.incoming.length > 0}>
      <h2>{t('trades_in')}</h2>
      {#if trades.incoming.length === 0}<p class="muted">{t('trades_none_in')}</p>{/if}
      {#each trades.incoming as trade (trade.id)}{@render tradeRow(trade, 'incoming')}{/each}
      {#if trades.incoming.length}<p class="muted small">{t('trade_deck_note')}</p>{/if}
    </section>

    <section class="panel">
      <h2>{t('new_trade')}</h2>
      <p class="muted small">{t('trade_rules')}</p>
      {#if friends.length === 0}
        <p class="muted">{t('trades_no_friends')}</p>
        <a class="btn" href="/friends">{t('add_friend')}</a>
      {/if}
      {#each friends as f (f.id)}
        <div class="row" data-testid="friend">
          <span class="name">{f.name}</span>
          <button class="btn btn-primary" disabled={busy} data-testid="propose-trade" onclick={() => openProposal(f)}>{t('propose_trade')}</button>
        </div>
      {/each}
    </section>

    {#if trades.outgoing.length}
      <section class="panel">
        <h2>{t('trades_out')}</h2>
        {#each trades.outgoing as trade (trade.id)}{@render tradeRow(trade, 'outgoing')}{/each}
      </section>
    {/if}

    {#if trades.history.length}
      <section class="panel">
        <details>
          <summary>{t('trade_history')} ({trades.history.length})</summary>
          {#each trades.history as trade (trade.id)}{@render tradeRow(trade, 'history')}{/each}
        </details>
      </section>
    {/if}
  {/if}
</main>

{#snippet picker(side: 'asked' | 'given', list: Item[], picked: Map<string, number>)}
  <div class="grid" data-testid={side === 'asked' ? 'theirs' : 'mine'}>
    {#each list.filter((c) => matches(c.cardId)) as c (c.cardId)}
      <div class="pick" class:on={picked.has(c.cardId)}>
        <MiniCard {ctx} defId={c.cardId} count={c.quantity} fresh={side === 'asked' && !mine.get(c.cardId)} onclick={() => tap(side, c)} />
        {#if picked.has(c.cardId)}<span class="picked">+{picked.get(c.cardId)}</span>{/if}
      </div>
    {/each}
  </div>
{/snippet}

{#if proposal}
  {@const p = proposal}
  {@const asked = total(p.asked)}
  {@const given = total(p.given)}
  <div class="sheet-backdrop" role="presentation" onclick={() => (proposal = null)}>
    <div class="sheet wide" role="dialog" aria-modal="true" aria-label={t('propose_trade')} tabindex="-1" data-testid="proposal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (proposal = null)}>
      <h2>{t('propose_trade')} · {p.friend.name}</h2>
      <p class="muted small">{t('trade_tap_hint')}</p>
      <input class="search" type="search" placeholder={t('trade_search')} aria-label={t('trade_search')} bind:value={search} />

      <h3>{t('trade_ask', { name: p.friend.name })} {#if asked}<span class="count">({asked})</span>{/if}</h3>
      {#if p.theirs.length === 0}<p class="muted">{t('trade_none_theirs', { name: p.friend.name })}</p>{/if}
      {@render picker('asked', p.theirs, p.asked)}

      <h3>{t('trade_offer')} {#if given}<span class="count">({given})</span>{/if}</h3>
      {@render picker('given', myItems, p.given)}

      <p class="summary" data-testid="trade-summary">{t('trade_summary', { g: given, r: asked })}</p>
      {#if message?.error}<p class="error">{message.text}</p>{/if}
      <div class="actions">
        <button class="btn btn-primary" disabled={busy || asked + given === 0} data-testid="send-trade" onclick={sendProposal}>{t('trade_send')}</button>
        <button class="btn" onclick={() => (proposal = null)}>{t('close')}</button>
      </div>
      <p class="muted small">{t('trade_deck_note')}</p>
    </div>
  </div>
{/if}

{#if detail}
  {@const def = ctx.cards[detail] as CardDef | undefined}
  {#if def}
    <div class="sheet-backdrop" role="presentation" onclick={() => (detail = null)}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={loc(def.name)} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (detail = null)}>
        <CardInfo {ctx} defId={detail} />
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
    margin: 0 0 6px;
    font-size: 20px;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 16px;
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
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .tabs {
    text-align: right;
    margin: 6px 0 0;
  }
  .tabs a {
    color: var(--accent);
    font-weight: 700;
  }
  .highlight {
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
  .ok {
    color: var(--win);
    font-weight: 700;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .row {
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .name {
    flex: 1 1 140px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .trade {
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }
  .trade-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin: 0 0 8px;
    flex-wrap: wrap;
  }
  .swap {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .side {
    flex: 1 1 200px;
    min-width: 0;
  }
  .side .cards {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  }
  .caption {
    font-size: 13px;
    color: var(--muted);
    margin: 0 0 4px;
  }
  .nothing {
    font-style: italic;
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
  .search {
    width: 100%;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--text);
    font-size: 16px;
    margin: 4px 0 0;
  }
  .count {
    color: var(--accent);
  }
  .summary {
    font-weight: 700;
    margin: 16px 0 0;
  }
  .arrow {
    align-self: center;
    font-size: 26px;
    color: var(--accent);
  }
  .status {
    font-weight: 700;
    font-size: 13px;
  }
  .status-accepted {
    color: var(--win);
  }
  .status-declined,
  .status-expired,
  .status-cancelled {
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .actions .btn {
    flex: 1 1 140px;
  }
  .grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    max-height: 40vh;
    overflow-y: auto;
  }
  .pick {
    position: relative;
    border-radius: 12px;
    outline: 3px solid transparent;
  }
  .pick.on {
    outline-color: var(--accent);
  }
  .wide {
    width: min(760px, 100%);
  }
  .close {
    margin-top: 16px;
    width: 100%;
  }
  details summary {
    cursor: pointer;
    font-weight: 700;
  }
  @media (max-width: 520px) {
    .arrow {
      display: none;
    }
  }
</style>
