<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import { errorText, locale, t } from '$lib/i18n';
  import { session } from '$lib/session.svelte';
  import { mountTurnstile, type Captcha } from '$lib/turnstile';
  import AuthLayout from '$lib/ui/AuthLayout.svelte';
  import type { PublicUser } from '@rabbithole/shared';

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
  /** Pot de miel : champ caché aux humains, que les robots remplissent. */
  let website = $state('');
  let error = $state<string | null>(null);
  let pending = $state(false);
  const next = page.url.searchParams.get('next') ?? '/';

  // Captcha invisible (si le serveur l'a activé).
  let captchaEl = $state<HTMLDivElement>();
  let captcha: Captcha | null = null;

  // Vérification par SMS (si le serveur la demande).
  let pendingId = $state<string | null>(null);
  let phone = $state('');
  let sentTo = $state<string | null>(null);
  let code = $state('');
  let resendIn = $state(0);
  let resendTimer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    void api
      .authConfig()
      .then(async (cfg) => {
        if (cfg.turnstileSiteKey && captchaEl) captcha = await mountTurnstile(captchaEl, cfg.turnstileSiteKey);
      })
      .catch(() => {});
    return () => {
      captcha?.destroy();
      if (resendTimer) clearInterval(resendTimer);
    };
  });

  function message(err: unknown): string {
    if (!(err instanceof ApiError)) return err instanceof Error && err.message === 'captcha_failed' ? errorText('captcha_failed') : t('err_generic');
    const retry = Number(err.body.retryAfter ?? 0);
    return errorText(err.code, { n: err.code === 'bad_code' ? Number(err.body.attemptsLeft ?? 0) : Math.max(1, Math.ceil(retry / 60)) });
  }

  async function done(user: PublicUser): Promise<void> {
    session.user = user;
    session.loaded = true;
    await goto(next);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    pending = true;
    error = null;
    try {
      await action();
    } catch (err) {
      error = message(err);
    } finally {
      pending = false;
    }
  }

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    void run(async () => {
      try {
        const captchaToken = captcha ? await captcha.token() : undefined;
        const res = await api.signup({ email, password, displayName, country, locale, website, captchaToken });
        if ('user' in res) await done(res.user);
        else pendingId = res.pendingId;
      } finally {
        captcha?.reset(); // un jeton ne sert qu'une fois
      }
    });
  }

  function sendCode(e?: SubmitEvent): void {
    e?.preventDefault();
    if (!pendingId) return;
    const id = pendingId;
    void run(async () => {
      sentTo = (await api.signupPhone(id, phone)).phone;
      code = '';
      resendIn = 60;
      if (resendTimer) clearInterval(resendTimer);
      resendTimer = setInterval(() => {
        resendIn = Math.max(0, resendIn - 1);
        if (resendIn === 0 && resendTimer) clearInterval(resendTimer);
      }, 1000);
    });
  }

  function verify(e: SubmitEvent): void {
    e.preventDefault();
    if (!pendingId) return;
    const id = pendingId;
    void run(async () => {
      try {
        await done((await api.signupVerify(id, code)).user);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'pending_expired') {
          pendingId = null;
          sentTo = null;
        }
        throw err;
      }
    });
  }
</script>

<AuthLayout title={pendingId ? t('phone_title') : t('signup')}>
  {#if !pendingId}
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
      <!-- Pot de miel : hors écran, ignoré par les lecteurs d'écran et la tabulation. -->
      <div class="hp" aria-hidden="true">
        <label>Website<input name="website" type="text" tabindex="-1" autocomplete="off" bind:value={website} /></label>
      </div>
      <div class="captcha" bind:this={captchaEl}></div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn btn-primary" type="submit" disabled={pending} data-testid="submit">{t('signup')}</button>
      <p class="alt"><a href="/login?next={encodeURIComponent(next)}">{t('have_account')}</a></p>
    </form>
  {:else}
    <p class="intro">{t('phone_intro')}</p>
    <form onsubmit={sendCode}>
      <label>
        {t('phone_label')}
        <input type="tel" autocomplete="tel" required placeholder="06 12 34 56 78" bind:value={phone} disabled={!!sentTo && resendIn > 0} data-testid="phone" />
      </label>
      {#if !sentTo}
        <button class="btn btn-primary" type="submit" disabled={pending} data-testid="send-code">{t('phone_send')}</button>
      {/if}
    </form>
    {#if sentTo}
      <form onsubmit={verify}>
        <p class="sent" role="status">{t('phone_sent', { phone: sentTo })}</p>
        <label>
          {t('code_label')}
          <input inputmode="numeric" autocomplete="one-time-code" required pattern="\d{'{6}'}" maxlength="6" bind:value={code} data-testid="code" />
        </label>
        <button class="btn btn-primary" type="submit" disabled={pending} data-testid="verify-code">{t('code_verify')}</button>
        <button class="btn" type="button" disabled={pending || resendIn > 0} onclick={() => sendCode()}>
          {t('phone_resend')}{resendIn > 0 ? ` (${resendIn} s)` : ''}
        </button>
      </form>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</AuthLayout>

<style>
  .hp {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .captcha:empty {
    display: none;
  }
  .intro,
  .sent {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.45;
  }
  .sent {
    margin: 0;
    color: var(--win);
    font-weight: 700;
  }
</style>
