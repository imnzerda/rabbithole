<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';

  /** Annonce du matin sur l'accueil : la Tendance du jour est publiée (section 8). Les notifications sont dans la cloche. */
  let trending = $state(0);

  onMount(() => {
    api
      .trending()
      .then((r) => (trending = r.cards.length))
      .catch(() => {});
  });
</script>

{#if trending}
  <a class="notice trending" href="/trending" data-testid="trending-banner">🔥 {t('trending_banner', { n: trending })}</a>
{/if}

<style>
  .notice {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 12px 0;
    padding: 12px 16px;
    border: 1px solid #ff8a3d;
    border-radius: 14px;
    background: var(--bg-2);
    color: var(--text);
    font-weight: 700;
    text-decoration: none;
  }
</style>
