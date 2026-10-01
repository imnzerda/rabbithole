<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import PageShell from '$lib/ui/PageShell.svelte';
  import { loadViewer } from '$lib/viewer.svelte';

  let showSensitive = $state(false);
  let saved = $state(false);
  let error = $state(false);

  onMount(async () => {
    const user = session.loaded ? session.user : await loadSession();
    if (!user) return goto('/login?next=/settings');
    showSensitive = user.showSensitive;
  });

  async function toggle(): Promise<void> {
    saved = error = false;
    try {
      showSensitive = (await api.settings(showSensitive)).showSensitive;
      if (session.user) session.user = { ...session.user, showSensitive };
      await loadViewer(true);
      saved = true;
    } catch {
      error = true;
      showSensitive = !showSensitive;
    }
  }
</script>

<PageShell title={t('settings')}>
  {#if session.user}
    <section class="panel">
      <h2>{t('sensitive_title')}</h2>
      <p class="muted">{t('sensitive_text')}</p>
      <label class="switch">
        <input type="checkbox" bind:checked={showSensitive} onchange={toggle} data-testid="sensitive-toggle" />
        <span>{t('sensitive_toggle')}</span>
      </label>
      {#if saved}<p class="notice" role="status">{t('sensitive_saved')}</p>{/if}
      {#if error}<p class="error" role="alert">{t('err_generic')}</p>{/if}
      <p class="muted small">{t('country_rules_note', { country: session.user.country })}</p>
    </section>
    <p class="links muted"><a href="/credits">{t('credits')}</a> · <a href="/takedown">{t('takedown')}</a></p>
  {/if}
</PageShell>

<style>
  h2 {
    margin: 0 0 8px;
    font-size: 18px;
  }
  .switch {
    display: flex !important;
    align-items: center;
    gap: 10px !important;
    color: var(--text) !important;
    font-size: 16px !important;
    margin: 12px 0;
  }
  .switch input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .small {
    font-size: 13px;
  }
  .links a {
    color: var(--accent);
  }
</style>
