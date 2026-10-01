<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { session } from '$lib/session.svelte';
  import AuthLayout from '$lib/ui/AuthLayout.svelte';

  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let pending = $state(false);
  const next = page.url.searchParams.get('next') ?? '/';

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    pending = true;
    error = null;
    try {
      session.user = (await api.login(email, password)).user;
      session.loaded = true;
      await goto(next);
    } catch (err) {
      error = err instanceof ApiError && err.code === 'invalid_credentials' ? t('err_invalid_credentials') : t('err_generic');
    } finally {
      pending = false;
    }
  }
</script>

<AuthLayout title={t('login')}>
  <form onsubmit={submit}>
    <label>{t('email')}<input type="email" autocomplete="email" required bind:value={email} data-testid="email" /></label>
    <label>{t('password')}<input type="password" autocomplete="current-password" required bind:value={password} data-testid="password" /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn btn-primary" type="submit" disabled={pending} data-testid="submit">{t('login')}</button>
    <p class="alt"><a href="/signup?next={encodeURIComponent(next)}">{t('no_account')}</a></p>
  </form>
</AuthLayout>
