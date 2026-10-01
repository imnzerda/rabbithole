<script lang="ts">
  import type { MatchContext, MatchResult, PlayerIndex } from '@rabbithole/engine';
  import { loc, t } from '../i18n';

  interface Props {
    ctx: MatchContext;
    result: MatchResult;
    you: PlayerIndex;
    terrainIds: (string | null)[];
    onreplay: () => void;
    onmenu: () => void;
  }
  let { ctx, result, you, terrainIds, onreplay, onmenu }: Props = $props();

  const opp = $derived(you === 0 ? 1 : 0);
  const outcome = $derived(result.winner === null ? 'draw' : result.winner === you ? 'victory' : 'defeat');
  const reason = $derived(
    result.reason === 'fold'
      ? result.winner === you
        ? t('reason_fold_them')
        : t('reason_fold_you')
      : t(`reason_${result.reason}`),
  );
  const points = $derived(outcome === 'draw' ? '±0' : `${outcome === 'victory' ? '+' : '−'}${result.stake}`);
</script>

<div class="sheet-backdrop">
  <div class="sheet end {outcome}" role="dialog" aria-modal="true" aria-label={t(outcome)} data-testid="end-screen">
    <p class="kicker">{reason}</p>
    <h2>{t(outcome)}</h2>
    <p class="points">{points} <span>{t('rank_points')}</span></p>

    <ul class="lanes">
      {#each result.terrainPowers as powers, i (i)}
        {@const mine = powers[you]}
        {@const theirs = powers[opp]}
        <li class:won={result.controllers[i] === you} class:lost={result.controllers[i] === opp}>
          <span class="name">{loc(ctx.terrains[terrainIds[i] ?? '']?.name)}</span>
          <span class="score">{mine} – {theirs}</span>
        </li>
      {/each}
    </ul>

    <div class="actions">
      <button class="btn" onclick={onmenu}>{t('menu')}</button>
      <button class="btn btn-primary" onclick={onreplay} data-testid="replay">{t('play_again')}</button>
    </div>
  </div>
</div>

<style>
  .end {
    text-align: center;
  }
  .kicker {
    margin: 0;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 13px;
  }
  h2 {
    margin: 6px 0;
    font-size: 48px;
  }
  .victory h2 {
    color: var(--win);
  }
  .defeat h2 {
    color: var(--lose);
  }
  .points {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }
  .points span {
    font-size: 14px;
    color: var(--muted);
    font-weight: 500;
  }
  .lanes {
    list-style: none;
    padding: 0;
    margin: 20px 0 0;
    display: grid;
    gap: 8px;
  }
  .lanes li {
    display: flex;
    justify-content: space-between;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--line);
  }
  .lanes li.won {
    border-color: var(--win);
  }
  .lanes li.lost {
    border-color: var(--lose);
  }
  .score {
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  .actions .btn {
    flex: 1;
  }
</style>
