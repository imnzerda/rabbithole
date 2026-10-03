<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { loc, locale, t } from '$lib/i18n';
  import { formatPrice } from '$lib/money';
  import { loadSession, session } from '$lib/session.svelte';

  /**
   * Page de paiement du prestataire sandbox (développement uniquement) : elle tient la place du site d'un
   * vrai prestataire. « Payer » fait envoyer au serveur un webhook signé ; c'est lui seul qui crédite.
   */
  type Session = Awaited<ReturnType<typeof api.sandboxSession>>['session'];
  const sessionId = page.url.searchParams.get('session') ?? '';
  // Page d'où vient le paiement (boutique ou pass) : on y revient après.
  const next = page.url.searchParams.get('next') === '/pass' ? '/pass' : '/shop';
  let info = $state.raw<Session | null>(null);
  let failed = $state(false);
  let busy = $state(false);

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/shop');
      info = await api.sandboxSession(sessionId).then((r) => r.session).catch(() => null);
      failed = !info;
    })();
  });

  async function act(action: 'pay' | 'cancel'): Promise<void> {
    busy = true;
    try {
      await api.sandboxAction(sessionId, action);
      await goto(`${next}?status=${action === 'pay' ? 'success' : 'cancel'}`);
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <section class="checkout" data-testid="sandbox-checkout">
    <p class="badge">SANDBOX</p>
    <h1>{t('sandbox_title')}</h1>
    <p class="muted">{t('sandbox_hint')}</p>
    {#if info}
      <p class="item">💎 {t('gems_count', { n: info.gems })} · {loc(info.name)}</p>
      {#if info.status !== 'pending'}
        <p class="muted">{t('sandbox_closed')}</p>
        <a class="btn" href="/shop">{t('shop')}</a>
      {:else}
        <div class="actions">
          <button class="btn btn-primary" disabled={busy} data-testid="sandbox-pay" onclick={() => act('pay')}>{t('sandbox_pay', { price: formatPrice(info.amount, info.currency, locale) })}</button>
          <button class="btn" disabled={busy} data-testid="sandbox-cancel" onclick={() => act('cancel')}>{t('cancel')}</button>
        </div>
      {/if}
    {:else if failed}
      <p class="error">{t('err_generic')}</p>
      <a class="btn" href="/shop">{t('shop')}</a>
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 520px;
    margin: 0 auto;
    padding: max(32px, env(safe-area-inset-top)) 16px 40px;
  }
  .checkout {
    background: #f7f7fb;
    color: #1d1d27;
    border-radius: 18px;
    padding: 24px;
  }
  .badge {
    display: inline-block;
    margin: 0 0 8px;
    padding: 2px 10px;
    border-radius: 999px;
    background: #ffd84d;
    color: #1d1d27;
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 0.1em;
  }
  h1 {
    margin: 0 0 8px;
  }
  .muted {
    color: #5b5b6e;
  }
  .item {
    font-size: 18px;
    font-weight: 700;
  }
  .error {
    color: #c62828;
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .actions .btn {
    flex: 1 1 160px;
  }
  .checkout .btn:not(.btn-primary) {
    background: #fff;
    color: #1d1d27;
    border-color: #c9c9d6;
  }
</style>
