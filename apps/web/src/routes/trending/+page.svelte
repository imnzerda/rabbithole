<script lang="ts">
  import { goto } from '$app/navigation';
  import type { TrendingCardDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api } from '$lib/api';
  import { locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  /** Tendance du jour (section 8) : les cartes dont la page Wikipédia explose, +1 puissance pendant 24 h. */
  let { data } = $props();
  const { ctx } = untrack(() => data.catalog);

  let day = $state<string | null>(null);
  let cards = $state.raw<TrendingCardDto[]>([]);
  let loaded = $state(false);
  let detail = $state<string | null>(null);

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/trending');
      const r = await api.trending();
      day = r.date;
      cards = r.cards.filter((c) => ctx.cards[c.cardId]);
      loaded = true;
    })();
  });

  const fmt = (n: number) => new Intl.NumberFormat(locale).format(n);
</script>

<main>
  <header class="top">
    <h1>🔥 {t('trending_title')}</h1>
  </header>

  <section class="panel">
    <p class="muted">{t('trending_hint')}</p>
    {#if loaded && cards.length === 0}
      <p class="muted" data-testid="trending-empty">{t('trending_empty')}</p>
    {/if}
    {#if day}<p class="date">{t('trending_date', { d: new Date(day).toLocaleDateString(locale) })}</p>{/if}
    <ol class="list" data-testid="trending">
      {#each cards as c, i (c.cardId)}
        <li>
          <span class="pos">{i + 1}</span>
          <div class="card"><MiniCard {ctx} defId={c.cardId} onclick={() => (detail = c.cardId)} /></div>
          <div class="info">
            <strong>×{fmt(c.score)}</strong>
            <span class="muted small">{t('trending_views', { v: fmt(c.views), a: fmt(c.average) })}</span>
            <span class="bonus">{t('trending_bonus')}</span>
          </div>
        </li>
      {/each}
    </ol>
  </section>
</main>

{#if detail}
  <div class="sheet-backdrop" role="presentation" onclick={() => (detail = null)}>
    <div class="sheet" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (detail = null)}>
      <CardInfo {ctx} defId={detail} />
      <button class="btn close" onclick={() => (detail = null)}>{t('close')}</button>
    </div>
  </div>
{/if}

<style>
  main {
    max-width: 760px;
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
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
  .date {
    font-weight: 700;
    margin: 12px 0 0;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
  }
  .list li {
    display: grid;
    grid-template-columns: 28px 86px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .pos {
    font-weight: 800;
    font-size: 18px;
    text-align: center;
  }
  .info {
    display: grid;
    gap: 4px;
  }
  .info strong {
    font-size: 20px;
    color: #ff8a3d;
  }
  .bonus {
    font-size: 13px;
    font-weight: 700;
    color: var(--win);
  }
  .close {
    margin-top: 16px;
    width: 100%;
  }
</style>
