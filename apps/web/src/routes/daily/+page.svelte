<script lang="ts">
  import { goto } from '$app/navigation';
  import type { DailyDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api } from '$lib/api';
  import { loc, locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  /**
   * Défi du jour (section 7) : deck imposé et adversaire identiques pour tous, une tentative comptée par jour,
   * score partagé façon Wordle (texte à emojis, sans dévoiler la partie).
   */
  let { data } = $props();
  const { ctx } = untrack(() => data.catalog);

  let daily = $state.raw<DailyDto | null>(null);
  let missing = $state(false);
  let detail = $state<string | null>(null);
  let copied = $state(false);

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/daily');
      daily = await api.daily().catch(() => null);
      missing = !daily;
    })();
  });

  // Les 20 cartes, regroupées par carte (« ×2 »).
  const deckCards = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const id of daily?.deck.cards ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].filter(([id]) => ctx.cards[id]);
  });

  /** Texte à partager : résultat et Vies en emojis, à la manière de Wordle. */
  const shareText = $derived.by(() => {
    const r = daily?.result;
    if (!daily || !r) return '';
    const day = new Date(daily.date).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
    const mine = '❤️'.repeat(r.livesLeft) + '🖤'.repeat(Math.max(0, r.lives - r.livesLeft));
    const theirs = '💥'.repeat(r.livesTaken) + '⬜'.repeat(Math.max(0, r.opponentLives - r.livesTaken));
    return [
      t('daily_share_title', { d: day }),
      `${r.won ? '🏆' : '💀'} ${t(r.won ? 'daily_share_won' : 'daily_share_lost', { n: r.turns })}`,
      `${t('daily_share_me')} ${mine}`,
      `${t('daily_share_them')} ${theirs}`,
      t('daily_share_score', { n: r.score }),
      '#RabbitHole',
    ].join('\n');
  });

  async function share(): Promise<void> {
    if (navigator.share) {
      await navigator.share({ text: shareText }).catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(shareText).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('daily_title')}</h1>
  </header>

  {#if missing}<p class="muted">{t('daily_missing')}</p>{/if}

  {#if daily}
    <section class="panel highlight">
      <p class="muted">{t('daily_hint')}</p>
      {#if daily.result}
        {@const r = daily.result}
        <div class="result" data-testid="daily-result">
          <p class="outcome" class:won={r.won}>{r.won ? '🏆' : '💀'} {t(r.won ? 'victory' : 'defeat')} · {t('daily_score', { n: r.score })}</p>
          <p class="muted">{t('daily_position', { n: daily.position ?? '-', total: daily.players })}</p>
          <pre class="share" data-testid="daily-share">{shareText}</pre>
          <button class="btn btn-primary" onclick={share}>{copied ? t('copied') : t('daily_share')}</button>
        </div>
      {:else}
        <a class="btn btn-primary play" href="/online?daily=1" data-testid="daily-play">{t('daily_play')}</a>
      {/if}
    </section>

    <section class="panel">
      <h2>{t('daily_deck', { name: loc(daily.deck.name) })}</h2>
      <div class="versus">
        <div class="side">
          <p class="caption">{t('daily_you')}</p>
          <div class="leader"><MiniCard {ctx} defId={daily.deck.leader} onclick={() => (detail = daily!.deck.leader)} /></div>
        </div>
        <span class="vs">VS</span>
        <div class="side">
          <p class="caption">{t('daily_opponent', { name: loc(daily.opponent.name) })}</p>
          <div class="leader"><MiniCard {ctx} defId={daily.opponent.leader} onclick={() => (detail = daily!.opponent.leader)} /></div>
        </div>
      </div>
      <div class="grid">
        {#each deckCards as [id, n] (id)}<MiniCard {ctx} defId={id} count={n} onclick={() => (detail = id)} />{/each}
      </div>
    </section>

    <section class="panel">
      <h2>{t('daily_board')}</h2>
      {#if daily.leaderboard.length === 0}<p class="muted">{t('daily_board_empty')}</p>{/if}
      <ol class="board" data-testid="daily-board">
        {#each daily.leaderboard as e (e.position)}
          <li class:you={e.you}>
            <span class="pos">{e.position}</span>
            <strong class="name">{e.name}</strong>
            <span class="muted small">{e.won ? '🏆' : '💀'} {t('daily_turns', { n: e.turns })}</span>
            <span class="pts">{e.score}</span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</main>

{#if detail}
  <div class="sheet-backdrop" role="presentation" onclick={() => (detail = null)}>
    <div class="sheet" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (detail = null)}>
      <CardInfo {ctx} defId={detail} />
      <button class="btn close" onclick={() => (detail = null)}>{t('close')}</button>
    </div>
  </div>
{/if}

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
    margin: 0 0 10px;
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
  .highlight {
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
  .play {
    display: block;
    margin-top: 14px;
    text-align: center;
  }
  .outcome {
    font-size: 22px;
    font-weight: 800;
    margin: 12px 0 4px;
    color: var(--lose);
  }
  .outcome.won {
    color: var(--win);
  }
  .share {
    white-space: pre-wrap;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px;
    font-family: inherit;
    line-height: 1.5;
  }
  .versus {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
  }
  .side {
    flex: 1;
    display: grid;
    justify-items: center;
    gap: 6px;
    text-align: center;
  }
  .caption {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .leader {
    width: 110px;
  }
  .vs {
    font-weight: 900;
    font-size: 22px;
    color: var(--accent);
  }
  .grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  }
  .board {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .board li {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto 56px;
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
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pts {
    font-weight: 800;
    text-align: right;
  }
  .close {
    margin-top: 16px;
    width: 100%;
  }
</style>
