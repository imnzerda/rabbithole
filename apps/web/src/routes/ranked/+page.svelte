<script lang="ts">
  import { goto } from '$app/navigation';
  import type { LeaderboardEntryDto, RankedDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { loc, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';

  /** Classé (section 7) : mon rang, ma progression, mes positions ; classements mondial et par pays. */
  let me = $state.raw<RankedDto | null>(null);
  let scope = $state<'all' | 'country'>('all');
  let entries = $state.raw<LeaderboardEntryDto[]>([]);
  let now = $state(Date.now());

  const RANK_ICON: Record<string, string> = { lurker: '👀', normie: '🙂', posteur: '✍️', influenceur: '📣', viral: '🚀', legende: '👑' };
  const rankName = (id: string) => t(`rank_${id as 'lurker'}`);

  async function loadBoard(): Promise<void> {
    if (!me) return;
    entries = (await api.leaderboard(scope === 'all' ? 'all' : me.country)).entries;
  }

  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 60_000);
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/ranked');
      me = await api.ranked();
      await loadBoard();
    })();
    return () => clearInterval(clock);
  });

  const progress = $derived(me?.next ? Math.min(100, ((me.points - me.rankMin) / (me.next.min - me.rankMin)) * 100) : 100);

  function countdown(iso: string): string {
    const ms = Math.max(0, Date.parse(iso) - now);
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    return d > 0 ? `${d} j ${h} h` : `${h} h`;
  }
</script>

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('ranked_title')}</h1>
  </header>

  {#if me}
    <section class="panel me" data-testid="my-rank">
      <div class="head">
        <h2>{t('ranked_season', { s: me.season })}</h2>
        <span class="muted">{t('pass_ends', { t: countdown(me.endsAt) })}</span>
      </div>
      <div class="rank-row">
        <span class="badge rank-{me.rank}" aria-hidden="true">{RANK_ICON[me.rank]}</span>
        <div>
          <p class="rank-name">{rankName(me.rank)}</p>
          <p class="muted">{t('ranked_points', { n: me.points })}</p>
        </div>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><span style:width="{progress}%"></span></div>
      <p class="muted small">
        {me.next ? t('ranked_next', { r: rankName(me.next.rank), n: me.next.min - me.points }) : t('ranked_max')}
      </p>
      <p class="record">
        {t('ranked_record', { w: me.wins, l: me.losses, d: me.draws })}
        {#if me.position}· {t('ranked_position', { n: me.position })} · {t('ranked_country_position', { n: me.countryPosition ?? '-' })}{/if}
      </p>
      <p class="muted small">{t('ranked_hint')}</p>
      <div class="ladder">
        {#each me.ranks as r (r.id)}
          <span class="step" class:on={r.id === me.rank} title="{rankName(r.id)} · {r.min}">{RANK_ICON[r.id]} {rankName(r.id)} <small>{r.min}</small></span>
        {/each}
      </div>
    </section>

    <section class="panel">
      <div class="tabs" role="tablist">
        <button class:on={scope === 'all'} role="tab" aria-selected={scope === 'all'} onclick={() => ((scope = 'all'), void loadBoard())}>🌍 {t('ranked_world')}</button>
        <button class:on={scope === 'country'} role="tab" aria-selected={scope === 'country'} data-testid="tab-country" onclick={() => ((scope = 'country'), void loadBoard())}>
          🏳️ {t('ranked_country', { c: me.country })}
        </button>
      </div>
      {#if entries.length === 0}<p class="muted">{t('ranked_empty')}</p>{/if}
      <ol class="board" data-testid="leaderboard">
        {#each entries as e (e.position)}
          <li class:you={e.you}>
            <span class="pos">{e.position}</span>
            <span class="who">
              <strong>{e.name}</strong>
              {#if e.title}<small class="title">« {loc(e.title)} »</small>{/if}
            </span>
            <span class="r">{RANK_ICON[e.rank]} {rankName(e.rank)}</span>
            <span class="pts">{e.points}</span>
          </li>
        {/each}
      </ol>
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
  .panel {
    margin-top: 18px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
  }
  .me {
    border-color: var(--accent);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .small {
    font-size: 13px;
    margin-top: 6px;
  }
  .rank-row {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 14px 0 10px;
  }
  .badge {
    width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    font-size: 34px;
    border-radius: 18px;
    background: var(--panel);
    border: 2px solid var(--accent);
  }
  .rank-name {
    margin: 0;
    font-size: 26px;
    font-weight: 800;
  }
  .bar {
    height: 10px;
    border-radius: 999px;
    background: var(--panel);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .record {
    font-weight: 700;
    margin: 12px 0 4px;
  }
  .ladder {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .step {
    font-size: 12px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--muted);
  }
  .step.on {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 25%, var(--panel));
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
  }
  .tabs button {
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
  }
  .tabs button.on {
    background: color-mix(in srgb, var(--accent) 30%, var(--panel));
    border-color: var(--accent);
  }
  .board {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .board li {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto 52px;
    gap: 10px;
    align-items: center;
    padding: 10px 6px;
    border-top: 1px solid var(--line);
  }
  .board li.you {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-radius: 10px;
  }
  .pos {
    font-weight: 800;
    text-align: center;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .who strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    color: var(--muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .r {
    font-size: 13px;
    white-space: nowrap;
  }
  .pts {
    font-weight: 800;
    text-align: right;
  }
</style>
