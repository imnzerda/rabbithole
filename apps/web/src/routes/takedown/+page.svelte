<script lang="ts">
  import { page } from '$app/state';
  import { loc, locale, t } from '$lib/i18n';
  import { api, ApiError } from '$lib/api';
  import { loadCatalog } from '$lib/catalog';
  import { onMount } from 'svelte';
  import PageShell from '$lib/ui/PageShell.svelte';

  /** Demande de retrait (section 5) : publique, sans compte. Traitée sous 72 h depuis l'outil d'admin. */
  let cards = $state.raw<{ id: string; name: string }[]>([]);
  let cardId = $state(page.url.searchParams.get('card') ?? '');
  let name = $state('');
  let contact = $state('');
  let relation = $state('self');
  let reason = $state('');
  let dueAt = $state<string | null>(null);
  let error = $state<string | null>(null);
  let pending = $state(false);

  const RELATIONS = ['self', 'representative', 'rights_holder', 'other'] as const;

  onMount(async () => {
    const { ctx } = await loadCatalog();
    cards = Object.values(ctx.cards)
      .map((c) => ({ id: c.id, name: loc(c.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  });

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    pending = true;
    error = null;
    try {
      dueAt = (await api.takedown({ cardId, name, contact, relation, reason })).dueAt;
    } catch (err) {
      error = err instanceof ApiError && err.code === 'invalid_input' ? t('err_invalid_input') : t('err_generic');
    } finally {
      pending = false;
    }
  }
</script>

<PageShell title={t('takedown')}>
  <p class="muted">{t('takedown_intro')}</p>
  {#if dueAt}
    <p class="notice panel" role="status">{t('takedown_done', { date: new Date(dueAt).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US') })}</p>
  {:else}
    <form class="panel" onsubmit={submit}>
      <label>
        {t('takedown_card')}
        <select required bind:value={cardId} data-testid="takedown-card">
          <option value="" disabled>—</option>
          {#each cards as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label>{t('takedown_name')}<input required minlength="2" maxlength="120" bind:value={name} /></label>
      <label>{t('takedown_contact')}<input type="email" required bind:value={contact} /></label>
      <label>
        {t('takedown_relation')}
        <select bind:value={relation}>
          {#each RELATIONS as r (r)}<option value={r}>{t(`takedown_relation_${r}`)}</option>{/each}
        </select>
      </label>
      <label>{t('takedown_reason')}<textarea required minlength="10" maxlength="4000" rows="5" bind:value={reason}></textarea></label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn btn-primary" type="submit" disabled={pending} data-testid="takedown-send">{t('takedown_send')}</button>
    </form>
  {/if}
</PageShell>
