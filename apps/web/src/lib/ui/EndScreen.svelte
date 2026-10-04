<script lang="ts">
  import type { MatchResult, PlayerIndex } from '@rabbithole/engine';
  import type { RankedResultDto } from '@rabbithole/shared';
  import { t } from '../i18n';
  import ReportDialog from './ReportDialog.svelte';

  interface Props {
    result: MatchResult;
    you: PlayerIndex;
    /** « Rejouer » (absent : pas de bouton). */
    onreplay?: () => void;
    onmenu: () => void;
    /** Pièces gagnées (parties en ligne). */
    reward?: number | null;
    /** Partie en ligne contre un humain : on peut signaler l'adversaire. */
    reportMatchId?: string | null;
    /** Points de classement (partie classée) : évolution et rang. */
    ranked?: RankedResultDto | null;
  }
  let { result, you, onreplay, onmenu, reward = null, reportMatchId = null, ranked = null }: Props = $props();
  let reporting = $state(false);

  const opp = $derived(you === 0 ? 1 : 0);
  const outcome = $derived(result.winner === null ? 'draw' : result.winner === you ? 'victory' : 'defeat');
  const reason = $derived(
    result.reason === 'fold' ? (result.winner === you ? t('reason_fold_them') : t('reason_fold_you')) : t(`reason_${result.reason}`),
  );
  const points = $derived(ranked ? (ranked.delta > 0 ? `+${ranked.delta}` : ranked.delta < 0 ? `−${-ranked.delta}` : '±0') : '');
  const rankUp = $derived(ranked !== null && ranked.rank !== ranked.rankBefore);
</script>

<div class="sheet-backdrop">
  <div class="sheet end {outcome}" role="dialog" aria-modal="true" aria-label={t(outcome)} data-testid="end-screen">
    <p class="kicker">{reason}</p>
    <h2>{t(outcome)}</h2>
    {#if ranked}
      <p class="points" data-testid="ranked-points">{points} <span>{t('rank_points')}{result.stake > 1 ? ` · ${t('stake_x', { n: result.stake })}` : ''}</span></p>
      <p class="rank" class:up={rankUp} data-testid="ranked-rank">
        {rankUp ? t('rank_new', { r: t(`rank_${ranked.rank as 'lurker'}`) }) : t('rank_now', { r: t(`rank_${ranked.rank as 'lurker'}`), n: ranked.after })}
      </p>
    {/if}
    {#if reward !== null}<p class="reward" data-testid="reward">{t('reward', { n: reward })}</p>{/if}
    <p class="stats">
      {t('lives_left', { me: result.life[you], them: result.life[opp] })} · {t('turns_played', { n: result.turns })}
    </p>
    <div class="actions">
      <button class="btn" onclick={onmenu}>{t('menu')}</button>
      {#if onreplay}<button class="btn btn-primary" onclick={onreplay} data-testid="replay">{t('play_again')}</button>{/if}
    </div>
    {#if reportMatchId}<button class="report-link" onclick={() => (reporting = true)} data-testid="report-player">{t('report_player')}</button>{/if}
  </div>
</div>
{#if reporting && reportMatchId}<ReportDialog target={{ type: 'player', matchId: reportMatchId }} onclose={() => (reporting = false)} />{/if}

<style>
  .report-link {
    margin-top: 14px;
    background: none;
    color: var(--muted);
    text-decoration: underline;
    font-size: 13px;
  }
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
  .rank {
    margin: 4px 0 0;
    font-weight: 700;
    color: var(--muted);
  }
  .rank.up {
    color: var(--win);
    font-size: 18px;
  }
  .points span {
    font-size: 14px;
    color: var(--muted);
    font-weight: 500;
  }
  .reward {
    margin: 8px 0 0;
    font-size: 20px;
    font-weight: 700;
    color: #ffc94a;
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
