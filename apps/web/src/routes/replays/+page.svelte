<script lang="ts">
  import { goto } from '$app/navigation';
  import type { MatchSummary } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';

  let matches = $state.raw<MatchSummary[] | null>(null);

  onMount(async () => {
    const user = session.loaded ? session.user : await loadSession();
    if (!user) return goto('/login?next=/replays');
    matches = (await api.matches()).matches;
  });

  const outcome = (m: MatchSummary) => (m.result.winner === null ? 'draw' : m.result.winner === m.you ? 'victory' : 'defeat');
  const date = (iso: string) => new Date(iso).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<main>
  <header>
    <button class="icon" aria-label={t('back')} onclick={() => history.back()}>←</button>
    <h1>{t('history')}</h1>
  </header>

  {#if matches && matches.length === 0}
    <p class="muted">{t('no_matches')}</p>
  {:else if matches}
    <ul>
      {#each matches as m (m.id)}
        <li class={outcome(m)}>
          <div class="who">
            <strong>{t('versus', { name: m.opponent })}</strong>
            {#if m.ghost}<span class="badge">{t('ghost_badge')}</span>{/if}
            <span class="muted">{t(`mode_${m.mode}`)} · {date(m.createdAt)}</span>
          </div>
          <span class="res">{t(outcome(m))}</span>
          <a class="btn" href="/replays/{m.id}" data-testid="watch">{t('replay')}</a>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main {
    max-width: 820px;
    margin: 0 auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 32px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  h1 {
    margin: 0;
  }
  .icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    font-weight: 700;
  }
  ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-left: 4px solid var(--muted);
    border-radius: 14px;
  }
  li.victory {
    border-left-color: var(--win);
  }
  li.defeat {
    border-left-color: var(--lose);
  }
  .who {
    flex: 1;
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .badge {
    justify-self: start;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--accent-2);
    color: var(--accent-2);
  }
  .res {
    font-weight: 700;
  }
  .victory .res {
    color: var(--win);
  }
  .defeat .res {
    color: var(--lose);
  }
  .btn {
    text-decoration: none;
  }
</style>
