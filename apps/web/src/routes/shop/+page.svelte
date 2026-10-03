<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PurchaseDto, ShopDto, WalletDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { loc, locale, t } from '$lib/i18n';
  import { formatPrice, fromMinor, toMinor } from '$lib/money';
  import { loadSession, session } from '$lib/session.svelte';

  let shop = $state.raw<ShopDto | null>(null);
  let wallet = $state.raw<WalletDto | null>(null);
  let purchases = $state.raw<PurchaseDto[]>([]);
  let message = $state<{ text: string; error: boolean } | null>(null);
  let busy = $state(false);
  let capInput = $state('');

  const price = (amount: number, currency: string) => formatPrice(amount, currency, locale);

  async function refresh(): Promise<void> {
    const [s, w, p] = await Promise.all([api.shop(), api.wallet(), api.purchases()]);
    shop = s;
    wallet = w.wallet;
    purchases = p.purchases;
    capInput = s.spendCap === null ? '' : String(fromMinor(s.spendCap, s.currency));
  }

  onMount(() => {
    let poll: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/shop');
      await refresh();
      // Retour de la page de paiement : les gemmes n'arrivent qu'avec le webhook du prestataire.
      const status = page.url.searchParams.get('status');
      if (status === 'cancel') message = { text: t('payment_cancelled'), error: false };
      if (status === 'success') {
        const settled = () => {
          if (purchases.some((x) => x.status === 'pending')) return false;
          if (purchases[0]?.status === 'completed') message = { text: t('payment_done'), error: false };
          return true;
        };
        message = { text: t('payment_pending'), error: false };
        if (settled()) return;
        let tries = 0;
        poll = setInterval(async () => {
          await refresh();
          if (settled() || ++tries > 20) clearInterval(poll);
        }, 1500);
      }
    })();
    return () => clearInterval(poll);
  });

  const KNOWN_ERRORS = ['spend_cap_reached', 'shop_closed', 'unknown_product'] as const;
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
    }
  }

  const buy = (productId: string) =>
    run(async () => {
      const { url } = await api.checkout(productId);
      await goto(url);
    });

  const saveCap = (remove = false) =>
    run(async () => {
      if (!shop) return;
      const value = Number(capInput.replace(',', '.'));
      await api.setSpendCap(remove || !capInput.trim() || !Number.isFinite(value) ? null : toMinor(Math.max(0, value), shop.currency));
      await refresh();
      return t('spend_cap_saved');
    });
</script>

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('shop')}</h1>
    {#if wallet}<span class="gems" data-testid="gems" title={t('gems')}>💎 {wallet.gems}</span>{/if}
  </header>

  {#if message}<p class:error={message.error} class:ok={!message.error} role="status" data-testid="message">{message.text}</p>{/if}

  {#if shop}
    <section class="panel">
      <h2>{t('gems')}</h2>
      <p class="muted">{t('shop_hint')}</p>
      {#if !shop.enabled}
        <p class="muted">{t('shop_closed')}</p>
      {:else}
        <div class="packs">
          {#each shop.offers as offer (offer.id)}
            <div class="pack" data-testid="pack-{offer.id}">
              <span class="pack-icon" aria-hidden="true">💎</span>
              <strong>{t('gems_count', { n: offer.gems })}</strong>
              <span class="muted">{loc(offer.name)}</span>
              <button class="btn btn-primary" disabled={busy} onclick={() => buy(offer.id)}>{price(offer.amount, offer.currency)}</button>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="panel">
      <h2>{t('spend_cap')}</h2>
      <p class="muted">{t('spend_cap_hint')}</p>
      <p data-testid="month-spent">
        {shop.spendCap === null
          ? t('month_spent', { spent: price(shop.monthSpent, shop.currency) })
          : t('spend_cap_status', { spent: price(shop.monthSpent, shop.currency), cap: price(shop.spendCap, shop.currency) })}
      </p>
      <form
        class="cap"
        onsubmit={(e) => {
          e.preventDefault();
          void saveCap();
        }}
      >
        <input inputmode="decimal" aria-label={t('spend_cap')} placeholder="20" bind:value={capInput} data-testid="spend-cap" />
        <span class="currency">{shop.currency}</span>
        <button class="btn btn-primary" disabled={busy}>{t('spend_cap_save')}</button>
        {#if shop.spendCap !== null}<button type="button" class="btn" disabled={busy} onclick={() => saveCap(true)}>{t('spend_cap_remove')}</button>{/if}
      </form>
    </section>

    <section class="panel">
      <h2>{t('purchases')}</h2>
      {#if purchases.length === 0}<p class="muted">{t('no_purchases')}</p>{/if}
      {#each purchases as p (p.id)}
        <div class="row" data-testid="purchase">
          <span class="name">{p.gems ? `💎 ${p.gems}` : loc(p.name)}</span>
          <span>{price(p.amount, p.currency)}</span>
          <span class="muted date">{new Date(p.createdAt).toLocaleDateString(locale)}</span>
          <span class="status status-{p.status}">{t(`purchase_status_${p.status as 'completed'}`)}</span>
        </div>
      {/each}
    </section>
  {/if}
</main>

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
  .icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    font-weight: 700;
  }
  .gems {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 6px 12px;
    font-weight: 700;
  }
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .muted {
    color: var(--muted);
    margin: 0 0 10px;
  }
  .error {
    color: var(--lose);
    font-weight: 700;
  }
  .ok {
    color: var(--win);
    font-weight: 700;
  }
  .packs {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .pack {
    display: grid;
    gap: 6px;
    justify-items: center;
    text-align: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 14px 10px;
  }
  .pack .muted {
    margin: 0;
    font-size: 13px;
  }
  .pack .btn {
    width: 100%;
  }
  .pack-icon {
    font-size: 34px;
  }
  .cap {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .cap input {
    width: 110px;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--text);
    font-size: 16px;
  }
  .currency {
    font-weight: 700;
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .name {
    flex: 1 1 80px;
    font-weight: 700;
  }
  .date {
    margin: 0;
  }
  .status {
    font-weight: 700;
    font-size: 13px;
  }
  .status-completed {
    color: var(--win);
  }
  .status-refunded,
  .status-chargeback,
  .status-mismatch {
    color: var(--lose);
  }
</style>
