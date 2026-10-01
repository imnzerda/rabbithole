<script lang="ts">
  import { onMount } from 'svelte';
  import type { MatchContext } from '@rabbithole/engine';
  import { loadCatalog } from '$lib/catalog';
  import { loc, t } from '$lib/i18n';
  import PageShell from '$lib/ui/PageShell.svelte';
  import { loadViewer, viewer } from '$lib/viewer.svelte';

  /** Page publique « Crédits » (section 10.2) : chaque image, son auteur et sa licence. */
  let ctx = $state.raw<MatchContext | null>(null);
  const credits = $derived([...viewer.credits.values()]);

  onMount(async () => {
    ctx = (await loadCatalog()).ctx;
    await loadViewer();
  });
</script>

<PageShell title={t('credits')}>
  <p class="muted">{t('credits_intro')}</p>
  {#if viewer.loaded && credits.length === 0}
    <p class="muted">{t('credits_empty')}</p>
  {/if}
  <ul>
    {#each credits as c (c.cardId)}
      <li class="panel">
        <strong>{ctx?.cards[c.cardId] ? loc(ctx.cards[c.cardId]!.name) : c.cardId}</strong>
        <span>
          {t('photo_credit', { author: c.author, license: c.license, modified: c.modified ? t('photo_modified') : '' })}
          {#if c.licenseUrl}· <a href={c.licenseUrl} target="_blank" rel="noreferrer">{c.license}</a>{/if}
          · <a href={c.filePage} target="_blank" rel="noreferrer">{t('credits_source')}</a>
        </span>
      </li>
    {/each}
  </ul>
</PageShell>

<style>
  ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  li {
    display: grid;
    gap: 2px;
    padding: 10px 14px !important;
  }
  a {
    color: var(--accent);
  }
</style>
