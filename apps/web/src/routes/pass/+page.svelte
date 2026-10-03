<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { OfferDto, PassDto, PassReward, PassTrack } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { loc, locale, t } from '$lib/i18n';
  import { formatPrice } from '$lib/money';
  import { loadSession, session } from '$lib/session.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  /**
   * Pass saisonnier (section 6.6) : piste gratuite pour tous ; pistes premium et deluxe achetées en argent
   * réel, avec des cosmétiques et des boosters à aperçu (jamais de contenu caché ni d'avantage de jeu).
   */
  let { data } = $props();
  const { ctx } = untrack(() => data.catalog);

  let pass = $state.raw<PassDto | null>(null);
  let offers = $state.raw<OfferDto[]>([]);
  let message = $state<{ text: string; error: boolean } | null>(null);
  let busy = $state(false);
  let now = $state(Date.now());

  const TRACKS: PassTrack[] = ['free', 'premium', 'deluxe'];
  const RANK: Record<PassTrack, number> = { free: 0, premium: 1, deluxe: 2 };
  const offer = (id: string) => offers.find((o) => o.id === id);

  async function refresh(): Promise<void> {
    const r = await api.pass();
    pass = r.pass;
    offers = r.offers;
  }

  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 60_000);
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/pass');
      await refresh();
      const status = page.url.searchParams.get('status');
      if (status === 'success') message = { text: t('pass_bought'), error: false };
      if (status === 'cancel') message = { text: t('payment_cancelled'), error: false };
    })();
    return () => clearInterval(clock);
  });

  async function run(fn: () => Promise<string | void>): Promise<void> {
    busy = true;
    message = null;
    try {
      const ok = await fn();
      if (ok) message = { text: ok, error: false };
    } catch (e) {
      const known = ['spend_cap_reached', 'pass_not_available', 'shop_closed'] as const;
      const code = e instanceof ApiError ? known.find((k) => k === e.code) : undefined;
      message = { text: code ? t(`err_${code}`) : t('err_generic'), error: true };
    } finally {
      busy = false;
      await refresh().catch(() => {});
    }
  }

  const buy = (productId: string) =>
    run(async () => {
      const { url } = await api.checkout(productId, '/pass');
      await goto(url);
    });

  const claim = (tier: number, track: PassTrack) =>
    run(async () => {
      const r = await api.claimPass(tier, track);
      return t('pass_claimed', { r: rewardText(r.reward) });
    });

  function rewardText(r: PassReward): string {
    switch (r.type) {
      case 'coins':
        return `+${r.amount} 🪙`;
      case 'free_booster':
        return t('reward_free_booster', { n: r.count });
      case 'preview_booster':
        return t('reward_preview_booster', { n: r.count });
      case 'title':
        return t('reward_title', { name: loc(r.name) });
      case 'variant':
        return t('reward_variant', { card: ctx.cards[r.cardId] ? loc(ctx.cards[r.cardId]!.name) : r.cardId, v: t(`variant_${r.variant as 'holo'}`) });
    }
  }

  function countdown(iso: string): string {
    const ms = Math.max(0, Date.parse(iso) - now);
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    return d > 0 ? `${d} j ${h} h` : `${h} h`;
  }
</script>

{#snippet reward(tier: number, track: PassTrack, r: PassReward | null)}
  {#if !pass || !r}
    <div class="cell empty"></div>
  {:else}
    {@const claimed = pass.claimed[track]?.includes(tier)}
    {@const reached = pass.level >= tier}
    {@const unlocked = RANK[pass.track] >= RANK[track]}
    <div class="cell track-{track}" class:claimed data-testid="reward-{track}-{tier}">
      {#if r.type === 'variant' && ctx.cards[r.cardId]}
        <div class="thumb"><MiniCard {ctx} defId={r.cardId} variant={r.variant} /></div>
      {/if}
      <span class="label">{rewardText(r)}</span>
      {#if claimed}
        <span class="done">✓</span>
      {:else if !unlocked}
        <span class="lock" title={t('pass_locked_track')}>🔒</span>
      {:else}
        <button class="btn btn-primary small" disabled={busy || !reached} onclick={() => claim(tier, track)}>{t('mission_claim')}</button>
      {/if}
    </div>
  {/if}
{/snippet}

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('pass')}</h1>
  </header>

  {#if message}<p class:error={message.error} class:ok={!message.error} role="status" data-testid="message">{message.text}</p>{/if}

  {#if pass}
    <section class="panel">
      <div class="head">
        <h2>{t('pass_season', { n: pass.season })}</h2>
        <span class="muted">{t('pass_ends', { t: countdown(pass.endsAt) })}</span>
      </div>
      <p class="level" data-testid="pass-level">{t('pass_level', { n: pass.level, max: pass.tiers.length })} · <span class="track-name track-{pass.track}">{t(`pass_track_${pass.track}`)}</span></p>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={pass.xpPerTier} aria-valuenow={pass.xp % pass.xpPerTier}>
        <span style:width="{pass.level >= pass.tiers.length ? 100 : ((pass.xp % pass.xpPerTier) / pass.xpPerTier) * 100}%"></span>
      </div>
      <p class="muted small">{t('pass_xp', { xp: pass.xp % pass.xpPerTier, per: pass.xpPerTier })} · {t('pass_xp_hint')}</p>
    </section>

    {#if pass.track !== 'deluxe' && offers.length}
      <section class="panel buy">
        <h2>{t('pass_buy_title')}</h2>
        <p class="muted">{t('pass_buy_hint')}</p>
        <div class="offers">
          {#if pass.track === 'free'}
            {#each ['pass_premium', 'pass_deluxe'] as id (id)}
              {@const o = offer(id)}
              {#if o}
                <div class="offer track-{id === 'pass_premium' ? 'premium' : 'deluxe'}">
                  <strong>{loc(o.name)}</strong>
                  <span class="muted small">{t(id === 'pass_premium' ? 'pass_premium_desc' : 'pass_deluxe_desc')}</span>
                  <button class="btn btn-primary" disabled={busy} data-testid="buy-{id}" onclick={() => buy(id)}>{formatPrice(o.amount, o.currency, locale)}</button>
                </div>
              {/if}
            {/each}
          {:else if offer('pass_upgrade')}
            {@const o = offer('pass_upgrade')!}
            <div class="offer track-deluxe">
              <strong>{loc(o.name)}</strong>
              <span class="muted small">{t('pass_deluxe_desc')}</span>
              <button class="btn btn-primary" disabled={busy} data-testid="buy-pass_upgrade" onclick={() => buy('pass_upgrade')}>{formatPrice(o.amount, o.currency, locale)}</button>
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <section class="panel">
      <div class="grid-head">
        <span></span>
        {#each TRACKS as tr (tr)}<span class="track-name track-{tr}">{t(`pass_track_${tr}`)}</span>{/each}
      </div>
      {#each pass.tiers as tier (tier.tier)}
        <div class="row" class:reached={pass.level >= tier.tier} data-testid="tier">
          <span class="num">{tier.tier}</span>
          {@render reward(tier.tier, 'free', tier.free)}
          {@render reward(tier.tier, 'premium', tier.premium)}
          {@render reward(tier.tier, 'deluxe', tier.deluxe)}
        </div>
      {/each}
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 960px;
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
    margin: 0;
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
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
  .error {
    color: var(--lose);
    font-weight: 700;
  }
  .ok {
    color: var(--win);
    font-weight: 700;
  }
  .level {
    font-weight: 800;
    font-size: 18px;
    margin: 12px 0 6px;
  }
  .bar {
    height: 10px;
    border-radius: 999px;
    background: var(--panel);
    overflow: hidden;
    margin-bottom: 6px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .track-premium {
    --t: #4fb8ff;
  }
  .track-deluxe {
    --t: #ffc94a;
  }
  .track-free {
    --t: var(--muted);
  }
  .track-name {
    color: var(--t);
    font-weight: 800;
  }
  .buy {
    border-color: var(--accent);
  }
  .offers {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    margin-top: 12px;
  }
  .offer {
    display: grid;
    gap: 8px;
    padding: 14px;
    border-radius: 14px;
    border: 2px solid var(--t);
    background: var(--panel);
  }
  .grid-head,
  .row {
    display: grid;
    grid-template-columns: 34px repeat(3, minmax(0, 1fr));
    gap: 8px;
    align-items: stretch;
  }
  .grid-head {
    font-size: 13px;
    text-align: center;
    margin-bottom: 8px;
  }
  .row {
    padding: 6px 0;
    border-top: 1px solid var(--line);
    opacity: 0.55;
  }
  .row.reached {
    opacity: 1;
  }
  .num {
    align-self: center;
    font-weight: 800;
    text-align: center;
  }
  .cell {
    display: grid;
    gap: 6px;
    justify-items: center;
    align-content: center;
    text-align: center;
    padding: 8px 6px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--t) 50%, transparent);
    background: color-mix(in srgb, var(--t) 8%, var(--panel));
    min-width: 0;
  }
  .cell.empty {
    border: none;
    background: none;
  }
  .cell.claimed {
    opacity: 0.6;
  }
  .label {
    font-size: 12px;
    font-weight: 700;
    overflow-wrap: break-word;
    hyphens: auto;
  }
  .thumb {
    width: min(70px, 100%);
  }
  .done {
    color: var(--win);
    font-weight: 800;
  }
  .btn.small {
    padding: 6px 10px;
    font-size: 13px;
  }
</style>
