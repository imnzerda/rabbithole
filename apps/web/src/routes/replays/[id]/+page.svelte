<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { prototypeContext } from '@rabbithole/content';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { t } from '$lib/i18n';
  import { ReplayMatch } from '$lib/match/replay';
  import { loadSession, session } from '$lib/session.svelte';
  import Game from '$lib/ui/Game.svelte';

  const ctx = prototypeContext();
  let client = $state.raw<ReplayMatch | null>(null);
  let playing = $state(true);
  let progress = $state({ index: 0, total: 0 });
  let error = $state<string | null>(null);

  onMount(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto(`/login?next=/replays/${page.params.id}`);
      try {
        const { replay } = await api.replay(page.params.id ?? '');
        // Le moteur rejoue seed + decks + actions : le résultat est identique à la partie jouée.
        client = new ReplayMatch(ctx, replay, replay.you);
        timer = setInterval(() => {
          if (!client) return;
          progress = client.progress;
          playing = client.playing;
        }, 300);
      } catch {
        error = t('err_generic');
      }
    })();
    return () => {
      if (timer) clearInterval(timer);
    };
  });

  function toggle(): void {
    if (!client) return;
    if (client.playing) client.pause();
    else client.resume();
    playing = client.playing;
  }
</script>

<div class="screen">
  <nav class="controls">
    <button class="btn" onclick={() => goto('/replays')}>← {t('history')}</button>
    <span class="title">{t('replay_title')} · {progress.index}/{progress.total}</span>
    <button class="btn" onclick={toggle} disabled={!client}>{playing ? t('pause') : t('resume')}</button>
    <button class="btn" onclick={() => client?.next()} disabled={!client || playing}>{t('step')}</button>
  </nav>
  <div class="game">
    {#if error}
      <p class="error">{error}</p>
    {:else if client}
      <Game {client} onexit={() => goto('/replays')} />
    {/if}
  </div>
</div>

<style>
  .screen {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .title {
    flex: 1;
    font-weight: 700;
    text-align: center;
  }
  .game {
    flex: 1;
    min-height: 0;
  }
  .error {
    color: var(--lose);
    text-align: center;
    margin-top: 40px;
  }
</style>
