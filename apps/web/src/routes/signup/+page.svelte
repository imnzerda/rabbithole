<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import { locale, t } from '$lib/i18n';
  import { session } from '$lib/session.svelte';
  import AuthLayout from '$lib/ui/AuthLayout.svelte';

  /** Pays proposés au lancement (section 4.5) ; la liste complète viendra avec l'i18n (phase 8). */
  const COUNTRIES = [
    ['FR', 'France'],
    ['BE', 'Belgique'],
    ['CH', 'Suisse'],
    ['CA', 'Canada'],
    ['US', 'United States'],
    ['GB', 'United Kingdom'],
    ['BR', 'Brasil'],
    ['MX', 'México'],
    ['ES', 'España'],
    ['DE', 'Deutschland'],
    ['IT', 'Italia'],
    ['PL', 'Polska'],
    ['JP', '日本'],
    ['PH', 'Philippines'],
  ] as const;

  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let country = $state(locale === 'fr' ? 'FR' : 'US');
  let error = $state<string | null>(null);
  let pending = $state(false);
  const next = page.url.searchParams.get('next') ?? '/';

  function message(err: unknown): string {
    if (!(err instanceof ApiError)) return t('err_generic');
    switch (err.code) {
      case 'device_has_account':
        return t('err_device_has_account');
      case 'disposable_email':
        return t('err_disposable_email');
      case 'email_taken':
        return t('err_email_taken');
      case 'invalid_input':
        return t('err_invalid_input');
      default:
        return t('err_generic');
    }
  }

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    pending = true;
    error = null;
    try {
      session.user = (await api.signup({ email, password, displayName, country, locale })).user;
      session.loaded = true;
      await goto(next);
    } catch (err) {
      error = message(err);
    } finally {
      pending = false;
    }
  }
</script>

<AuthLayout title={t('signup')}>
  <form onsubmit={submit}>
    <label>{t('display_name')}<input autocomplete="nickname" required minlength="2" maxlength="24" bind:value={displayName} data-testid="name" /></label>
    <label>{t('email')}<input type="email" autocomplete="email" required bind:value={email} data-testid="email" /></label>
    <label>
      {t('password')} <small>({t('password_hint')})</small>
      <input type="password" autocomplete="new-password" required minlength="8" bind:value={password} data-testid="password" />
    </label>
    <label>
      {t('country')}
      <select bind:value={country} data-testid="country">
        {#each COUNTRIES as [code, name] (code)}<option value={code}>{name}</option>{/each}
      </select>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn btn-primary" type="submit" disabled={pending} data-testid="submit">{t('signup')}</button>
    <p class="alt"><a href="/login?next={encodeURIComponent(next)}">{t('have_account')}</a></p>
  </form>
</AuthLayout>

