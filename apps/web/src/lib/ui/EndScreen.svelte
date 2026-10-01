<script lang="ts">
  import type { MatchResult, PlayerIndex } from '@rabbithole/engine';
  import { t } from '../i18n';

  interface Props {
    result: MatchResult;
    you: PlayerIndex;
    onreplay: () => void;
    onmenu: () => void;
  }
  let { result, you, onreplay, onmenu }: Props = $props();

  const opp = $derived(you === 0 ? 1 : 0);
  const outcome = $derived(result.winner === null ? 'draw' : result.winner === you ? 'victory' : 'defeat');
  const reason = $derived(
    result.reason === 'fold' ? (result.winner === you ? t('reason_fold_them') : t('reason_fold_you')) : t(`reason_${result.reason}`),
  );
  const points = $derived(outcome === 'draw' ? '±0' : `${outcome === 'victory' ? '+' : '−'}${result.stake}`);
</script>

<div class="sheet-backdrop">
  <div class="sheet end {outcome}" role="dialog" aria-modal="true" aria-label={t(outcome)} data-testid="end-screen">
    <p class="kicker">{reason}</p>
    <h2>{t(outcome)}</h2>
    <p class="points">{points} <span>{t('rank_points')}</span></p>
    <p class="stats">
      {t('lives_left', { me: result.life[you], them: result.life[opp] })} · {t('turns_played', { n: result.turns })}
    </p>
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
  .stats {
    color: var(--muted);
    margin: 12px 0 0;
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
