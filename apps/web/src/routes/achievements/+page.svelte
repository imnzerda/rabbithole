<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORY_NAMES, type CategoryId } from '@rabbithole/engine';
  import type { AchievementDto, AchievementsDto, CosmeticsDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { loc, locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';

  /** Succès, titres et progression de collection (section 13). */
  let data = $state.raw<AchievementsDto | null>(null);
  let cosmetics = $state.raw<CosmeticsDto | null>(null);
  let message = $state<{ text: string; error: boolean } | null>(null);
  let busy = $state(false);

  // À réclamer d'abord, puis en cours (les plus avancés d'abord), puis réclamés.
  const sorted = $derived(
    [...(data?.achievements ?? [])].sort((a, b) => {
      const rank = (x: AchievementDto) => (x.unlocked && !x.claimed ? 0 : x.claimed ? 2 : 1);
      return rank(a) - rank(b) || b.progress / b.target - a.progress / a.target;
    }),
  );

  async function refresh(): Promise<void> {
    const [a, c] = await Promise.all([api.achievements(), api.cosmetics()]);
    data = a;
    cosmetics = c;
  }

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/achievements');
      await refresh();
    })();
  });

  async function run(fn: () => Promise<string>): Promise<void> {
    busy = true;
    message = null;
    try {
      message = { text: await fn(), error: false };
    } catch {
      message = { text: t('err_generic'), error: true };
    } finally {
      busy = false;
      await refresh().catch(() => {});
    }
  }

  function label(a: AchievementDto): string {
    if (a.category) {
      const c = a.category as CategoryId;
      return t('ach_specialist', { c: `${CATEGORY_STYLE[c].glyph} ${CATEGORY_NAMES[c][locale]}` });
    }
    if (a.metric === 'best_rank_points') return t('ach_best_rank_points');
    return t(`ach_${a.metric as 'games'}${a.target === 1 ? ('_one' as const) : ''}`, { n: a.target });
  }
</script>

<main>
  <header class="top">
    <h1>{t('achievements')}</h1>
  </header>

  {#if message}<p class:error={message.error} class:ok={!message.error} role="status" data-testid="message">{message.text}</p>{/if}

  {#if data && cosmetics}
    {@const c = data.collection}
    <section class="panel highlight" data-testid="collection-progress">
      <div class="head">
        <h2>{t('collection_progress')}</h2>
        <span class="level">{t('collection_level', { n: c.level })}</span>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={c.pointsPerLevel} aria-valuenow={c.points % c.pointsPerLevel}>
        <span style:width="{((c.points % c.pointsPerLevel) / c.pointsPerLevel) * 100}%"></span>
      </div>
      <p class="muted small">{t('collection_progress_hint', { p: c.points % c.pointsPerLevel, per: c.pointsPerLevel })}</p>
      <button
        class="btn btn-primary"
        disabled={busy || c.claimable === 0}
        data-testid="claim-collection"
        onclick={() =>
          run(async () => {
            const r = (await api.claimCollection()).reward;
            return t('collection_claimed', { n: r.levels, coins: r.coins, b: r.freeBoosters });
          })}
      >
        {c.claimable > 0 ? t('collection_claim', { n: c.claimable, coins: c.claimable * c.reward.coins, b: c.claimable * c.reward.freeBoosters }) : t('collection_next')}
      </button>
    </section>

    <section class="panel">
      <h2>{t('titles')}</h2>
      {#if cosmetics.titles.length === 0}
        <p class="muted">{t('titles_none')}</p>
      {:else}
        <div class="titles" data-testid="titles">
          <button class="chip" class:on={!cosmetics.activeTitle} disabled={busy} onclick={() => run(async () => (await api.setTitle(null), t('title_removed')))}>{t('title_none')}</button>
          {#each cosmetics.titles as title (title.id)}
            <button
              class="chip"
              class:on={cosmetics.activeTitle === title.id}
              disabled={busy}
              onclick={() => run(async () => (await api.setTitle(title.id), t('title_set', { name: loc(title.name) })))}
            >
              🏷️ {loc(title.name)}
            </button>
          {/each}
        </div>
        <p class="muted small">{t('titles_hint')}</p>
      {/if}
    </section>

    <section class="panel">
      <h2>{t('achievements')} · {data.achievements.filter((a) => a.claimed).length} / {data.achievements.length}</h2>
      {#each sorted as a (a.id)}
        <div class="row" class:done={a.claimed} data-testid="achievement">
          <div class="text">
            <span class="label">{label(a)}</span>
            <div class="bar thin"><span style:width="{(a.progress / a.target) * 100}%"></span></div>
            <span class="muted small">{a.progress} / {a.target} · +{a.coins} 🪙{a.title ? ` · 🏷️ ${loc(a.title)}` : ''}</span>
          </div>
          {#if a.claimed}
            <span class="claimed">✓</span>
          {:else}
            <button
              class="btn btn-primary small"
              disabled={busy || !a.unlocked}
              data-testid="claim-{a.id}"
              onclick={() =>
                run(async () => {
                  const r = (await api.claimAchievement(a.id)).reward;
                  return r.title ? t('ach_claimed_title', { n: r.coins, name: loc(r.title) }) : t('mission_claimed', { n: r.coins });
                })}
            >
              {t('mission_claim')}
            </button>
          {/if}
        </div>
      {/each}
    </section>
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
    margin: 0 0 8px;
    font-size: 20px;
  }
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .highlight {
    border-color: var(--accent);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }
  .level {
    font-weight: 800;
  }
  .muted {
    color: var(--muted);
    margin: 0;
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
  .bar {
    height: 10px;
    border-radius: 999px;
    background: var(--panel);
    overflow: hidden;
    margin: 8px 0 6px;
  }
  .bar.thin {
    height: 6px;
    margin: 4px 0;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .highlight .btn {
    margin-top: 12px;
    width: 100%;
  }
  .titles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .chip {
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
    font-size: 13px;
  }
  .chip.on {
    background: color-mix(in srgb, var(--accent) 30%, var(--panel));
    border-color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .row.done {
    opacity: 0.6;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .label {
    font-weight: 700;
  }
  .claimed {
    color: var(--win);
    font-weight: 800;
    font-size: 20px;
  }
  .btn.small {
    padding: 6px 12px;
    font-size: 13px;
  }
</style>
