<script lang="ts">
  import { goto } from '$app/navigation';
  import { RARITIES, type CardDef, type Rarity } from '@rabbithole/engine';
  import type { FriendDto, FriendsDto, TradeDto } from '@rabbithole/shared';
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
  let friends = $state.raw<FriendsDto | null>(null);
  let trades = $state.raw<Trades | null>(null);
  let mine = $state.raw(new Map<string, number>());
  let target = $state('');
  let message = $state<{ text: string; error: boolean } | null>(null);
  let busy = $state(false);
  let copied = $state(false);
  let detail = $state<string | null>(null);
  let now = $state(Date.now());

  // Proposition d'échange en cours : l'ami, sa carte, puis la mienne (même rareté).
  let proposal = $state<{ friend: FriendDto; theirs: { cardId: string; quantity: number }[]; wanted: string | null; offered: string | null } | null>(null);
  const wantedRarity = $derived(proposal?.wanted ? ctx.cards[proposal.wanted]!.rarity : null);
  const myOptions = $derived(
    wantedRarity ? [...mine].filter(([id, n]) => n > 0 && tradable(id) && ctx.cards[id]!.rarity === wantedRarity && id !== proposal?.wanted).map(([id]) => id) : [],
  );

  async function refresh(): Promise<void> {
    const [f, tr, c] = await Promise.all([api.friends(), api.trades(), api.collection()]);
    friends = f;
    trades = tr;
    mine = new Map(c.cards.map((x) => [x.cardId, x.quantity]));
  }

  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 30_000);
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/friends');
      await refresh();
    })();
    return () => clearInterval(clock);
  });

  const KNOWN_ERRORS = [
    'player_not_found',
    'ambiguous_name',
    'self',
    'already_friends',
    'already_requested',
    'daily_limit',
    'goat_weekly_limit',
    'linked_accounts',
    'not_owned',
    'not_owned_by_friend',
    'trade_expired',
    'trade_closed',
    'rarity_mismatch',
    'not_friends',
    'too_many_pending',
    'too_many_requests',
  ] as const;

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

  // Un code ami : 8 caractères hexadécimaux ; sinon, c'est un pseudo.
  const addFriend = () =>
    run(async () => {
      const value = target.trim();
      if (!value) return;
      const r = await api.addFriend(/^[0-9a-f]{8}$/i.test(value) ? { code: value } : { name: value });
      target = '';
      return t(r.accepted ? 'friend_added' : 'friend_requested', { name: r.name });
    });

  const copyCode = async () => {
    if (!friends) return;
    await navigator.clipboard?.writeText(friends.code).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  };

  const removeFriend = (f: FriendDto) => {
    if (confirm(t('remove_friend_confirm', { name: f.name }))) void run(() => api.removeFriend(f.id).then(() => undefined));
  };

  const openProposal = (friend: FriendDto) =>
    run(async () => {
      const { cards } = await api.friendCollection(friend.id);
      proposal = {
        friend,
        theirs: cards.filter((c) => tradable(c.cardId)).sort((a, b) => rarityRank(b.cardId) - rarityRank(a.cardId) || a.cardId.localeCompare(b.cardId)),
        wanted: null,
        offered: null,
      };
    });

  const sendProposal = () =>
    run(async () => {
      if (!proposal?.wanted || !proposal.offered) return;
      await api.proposeTrade(proposal.friend.id, proposal.offered, proposal.wanted);
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
    return { other: sent ? trade.toUser.name : trade.fromUser.name, receive: sent ? trade.requestedCardId : trade.offeredCardId, give: sent ? trade.offeredCardId : trade.requestedCardId };
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
      <figure>
        <figcaption>{t('trade_receive')}</figcaption>
        <MiniCard {ctx} defId={s.receive} fresh={!mine.get(s.receive)} onclick={() => (detail = s.receive)} />
      </figure>
      <span class="arrow" aria-hidden="true">⇄</span>
      <figure>
        <figcaption>{t('trade_give')}</figcaption>
        <MiniCard {ctx} defId={s.give} onclick={() => (detail = s.give)} />
      </figure>
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
    <h1>{t('friends_title')}</h1>
  </header>

  {#if message}<p class:error={message.error} class:ok={!message.error} role="status" data-testid="message">{message.text}</p>{/if}

  {#if friends && trades}
    <section class="panel">
      <h2>{t('friend_code')}</h2>
      <p class="muted">{t('friend_code_hint')}</p>
      <div class="code-row">
        <code data-testid="friend-code">{friends.code}</code>
        <button class="btn" onclick={copyCode}>{copied ? t('copied') : t('copy')}</button>
      </div>
      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          void addFriend();
        }}
      >
        <label class="sr-only" for="friend-target">{t('add_friend')}</label>
        <input id="friend-target" data-testid="friend-target" placeholder={t('add_friend_placeholder')} maxlength="40" bind:value={target} />
        <button class="btn btn-primary" disabled={busy || !target.trim()} data-testid="add-friend">{t('add')}</button>
      </form>
    </section>

    {#if friends.incoming.length}
      <section class="panel">
        <h2>{t('requests_in')}</h2>
        {#each friends.incoming as f (f.id)}
          <div class="row">
            <span class="name">{f.name}</span>
            <button class="btn btn-primary" disabled={busy} data-testid="accept-friend" onclick={() => run(() => api.acceptFriend(f.id).then(() => t('friend_added', { name: f.name })))}>
              {t('accept')}
            </button>
            <button class="btn" disabled={busy} onclick={() => run(() => api.removeFriend(f.id).then(() => undefined))}>{t('decline')}</button>
          </div>
        {/each}
      </section>
    {/if}

    {#if trades.incoming.length}
      <section class="panel highlight">
        <h2>{t('trades_in')}</h2>
        {#each trades.incoming as trade (trade.id)}{@render tradeRow(trade, 'incoming')}{/each}
        <p class="muted small">{t('trade_deck_note')}</p>
      </section>
    {/if}

    <section class="panel">
      <h2>{t('my_friends')}</h2>
      <p class="muted small">{t('trade_limits', { n: trades.limits.perDay, g: trades.limits.goatPerWeek })}</p>
      {#if friends.friends.length === 0}
        <p class="muted">{t('no_friends')}</p>
      {/if}
      {#each friends.friends as f (f.id)}
        <div class="row" data-testid="friend">
          <span class="name">{f.name}</span>
          <button class="btn btn-primary" disabled={busy} data-testid="propose-trade" onclick={() => openProposal(f)}>{t('propose_trade')}</button>
          <button class="btn" disabled={busy} onclick={() => removeFriend(f)}>{t('remove_friend')}</button>
        </div>
      {/each}
      {#if friends.outgoing.length}
        <h3>{t('requests_out')}</h3>
        {#each friends.outgoing as f (f.id)}
          <div class="row">
            <span class="name muted">{f.name}</span>
            <button class="btn" disabled={busy} onclick={() => run(() => api.removeFriend(f.id).then(() => undefined))}>{t('cancel')}</button>
          </div>
        {/each}
      {/if}
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

{#if proposal}
  {@const p = proposal}
  <div class="sheet-backdrop" role="presentation" onclick={() => (proposal = null)}>
    <div class="sheet wide" role="dialog" aria-modal="true" aria-label={t('propose_trade')} tabindex="-1" data-testid="proposal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (proposal = null)}>
      <h2>{t('propose_trade')} · {p.friend.name}</h2>
      <h3>{t('trade_pick_theirs', { name: p.friend.name })}</h3>
      {#if p.theirs.length === 0}
        <p class="muted">{t('trade_none_theirs', { name: p.friend.name })}</p>
      {/if}
      <div class="grid" data-testid="theirs">
        {#each p.theirs as c (c.cardId)}
          <div class="pick" class:on={p.wanted === c.cardId}>
            <MiniCard {ctx} defId={c.cardId} count={c.quantity} fresh={!mine.get(c.cardId)} onclick={() => (proposal = { ...p, wanted: c.cardId, offered: null })} />
          </div>
        {/each}
      </div>
      {#if p.wanted && wantedRarity}
        <h3>{t('trade_pick_mine', { r: t(`rarity_${wantedRarity as Rarity}`) })}</h3>
        {#if myOptions.length === 0}<p class="muted">{t('trade_none_mine')}</p>{/if}
        <div class="grid" data-testid="mine">
          {#each myOptions as id (id)}
            <div class="pick" class:on={p.offered === id}>
              <MiniCard {ctx} defId={id} count={mine.get(id) ?? 0} onclick={() => (proposal = { ...p, offered: id })} />
            </div>
          {/each}
        </div>
      {/if}
      {#if message?.error}<p class="error">{message.text}</p>{/if}
      <div class="actions">
        <button class="btn btn-primary" disabled={busy || !p.wanted || !p.offered} data-testid="send-trade" onclick={sendProposal}>{t('trade_send')}</button>
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
  .code-row,
  .add,
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .add {
    margin-top: 14px;
  }
  .add input {
    flex: 1 1 200px;
    min-width: 0;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--text);
    font-size: 16px;
  }
  code {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.15em;
    background: var(--panel);
    border: 1px dashed var(--accent);
    border-radius: 12px;
    padding: 6px 14px;
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
    align-items: center;
    gap: 12px;
  }
  .swap figure {
    margin: 0;
    width: min(130px, 40vw);
  }
  figcaption {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .arrow {
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
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
