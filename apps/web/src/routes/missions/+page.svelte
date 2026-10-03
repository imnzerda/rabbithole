<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORY_NAMES, type CategoryId } from '@rabbithole/engine';
  import type { MissionDto, MissionsDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';

  /** Missions quotidiennes et hebdomadaires (section 13) : progression comptée par le serveur. */
  let missions = $state.raw<MissionsDto | null>(null);
  let coins = $state<number | null>(null);
  let message = $state<{ text: string; error: boolean } | null>(null);
  let busy = $state(false);
  let now = $state(Date.now());

  async function refresh(): Promise<void> {
    const [m, w] = await Promise.all([api.missions(), api.wallet()]);
    missions = m;
    coins = w.wallet.coins;
  }

  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 30_000);
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/missions');
      await refresh();
    })();
    return () => clearInterval(clock);
  });

  function label(m: MissionDto): string {
    if (m.kind === 'play_category' && m.category) {
      const c = m.category as CategoryId;
      return t(m.target === 1 ? 'mission_play_category_one' : 'mission_play_category', { n: m.target, c: `${CATEGORY_STYLE[c].glyph} ${CATEGORY_NAMES[c][locale]}` });
    }
    return t(`mission_${m.kind as 'play'}${m.target === 1 ? ('_one' as const) : ''}`, { n: m.target });
  }

  function countdown(iso: string): string {
    const ms = Math.max(0, Date.parse(iso) - now);
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }

  async function claim(m: MissionDto): Promise<void> {
    busy = true;
    message = null;
    try {
      const r = await api.claimMission(m.id);
      coins = r.wallet.coins;
      message = { text: t('mission_claimed', { n: r.reward.coins }), error: false };
    } catch {
      message = { text: t('err_generic'), error: true };
    } finally {
      busy = false;
      await refresh();
    }
  }
</script>

{#snippet list(title: string, period: { endsAt: string; missions: MissionDto[] })}
  <section class="panel">
    <div class="head">
      <h2>{title}</h2>
      <span class="muted">{t('mission_renews', { t: countdown(period.endsAt) })}</span>
    </div>
    {#each period.missions as m (m.id)}
      {@const done = m.progress >= m.target}
      <div class="mission" class:done data-testid="mission">
        <div class="text">
          <span class="label">{label(m)}</span>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={m.target} aria-valuenow={m.progress}>
            <span style:width="{(m.progress / m.target) * 100}%"></span>
          </div>
          <span class="muted small">{m.progress} / {m.target} · +{m.coins} 🪙</span>
        </div>
        {#if m.claimed}
          <span class="claimed">✓ {t('mission_done')}</span>
        {:else}
          <button class="btn btn-primary" disabled={busy || !done} data-testid="claim" onclick={() => claim(m)}>{t('mission_claim')}</button>
        {/if}
      </div>
    {/each}
  </section>
{/snippet}

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('missions')}</h1>
    {#if coins !== null}<span class="coins" data-testid="coins">🪙 {coins}</span>{/if}
  </header>

  {#if message}<p class:error={message.error} class:ok={!message.error} role="status" data-testid="message">{message.text}</p>{/if}

  {#if missions}
    {@render list(t('missions_daily'), missions.daily)}
    {@render list(t('missions_weekly'), missions.weekly)}
    <p class="muted small">{t('missions_hint')}</p>
  {/if}
</main>

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
  h2 {
    margin: 0;
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
  .coins {
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
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 13px;
  }
  .error {
    color: var(--lose);
    font-weight: 700;
  }
  .ok {
    color: var(--win);
    font-weight: 700;
  }
  .mission {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }
  .text {
    flex: 1;
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .label {
    font-weight: 700;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--panel);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
  }
  .done .bar span {
    background: var(--win);
  }
  .claimed {
    color: var(--win);
    font-weight: 700;
    white-space: nowrap;
  }
</style>
