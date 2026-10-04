<script lang="ts">
  import type { MatchResult, PlayerIndex } from '@rabbithole/engine';
  import type { RankedResultDto } from '@rabbithole/shared';
  import { t } from '../i18n';
  import { shareImage } from '../share/end-image';
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
    /** Image de fin de partie à partager (absent : pas de bouton). */
    image?: () => Promise<Blob>;
  }
  let { result, you, onreplay, onmenu, reward = null, reportMatchId = null, ranked = null, image }: Props = $props();
  let reporting = $state(false);
  // Partage : aperçu de l'image, puis partage natif (fichier) ou téléchargement.
  let shot = $state.raw<{ blob: Blob; url: string } | null>(null);
  let making = $state(false);
  let canShare = $state(false);

  async function openShare(): Promise<void> {
    if (!image || making) return;
    making = true;
    try {
      const blob = await image();
      shot = { blob, url: URL.createObjectURL(blob) };
      canShare = !!navigator.canShare?.({ files: [new File([blob], 'rabbit-hole.png', { type: 'image/png' })] });
    } finally {
      making = false;
    }
  }

  function closeShare(): void {
    if (shot) URL.revokeObjectURL(shot.url);
    shot = null;
  }

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
    {#if image}<button class="btn share" disabled={making} onclick={openShare} data-testid="share">{t('share_result')}</button>{/if}
    {#if reportMatchId}<button class="report-link" onclick={() => (reporting = true)} data-testid="report-player">{t('report_player')}</button>{/if}
  </div>
</div>
{#if shot}
  <div class="sheet-backdrop" role="presentation" onclick={closeShare}>
    <div class="sheet shot" role="dialog" aria-modal="true" aria-label={t('share_result')} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && closeShare()}>
      <img src={shot.url} alt={t('share_alt')} data-testid="share-preview" />
      <div class="actions">
        {#if canShare}<button class="btn btn-primary" onclick={() => shareImage(shot!.blob, t('share_text'))}>{t('share_send')}</button>{/if}
        <a class="btn" class:btn-primary={!canShare} href={shot.url} download="rabbit-hole.png" data-testid="share-download">{t('share_download')}</a>
        <button class="btn" onclick={closeShare}>{t('close')}</button>
      </div>
    </div>
  </div>
{/if}
{#if reporting && reportMatchId}<ReportDialog target={{ type: 'player', matchId: reportMatchId }} onclose={() => (reporting = false)} />{/if}

<style>
  .share {
    margin-top: 12px;
    width: 100%;
  }
  .shot {
    text-align: center;
  }
  .shot img {
    display: block;
    width: auto;
    max-width: 100%;
    max-height: 60vh;
    margin: 0 auto 14px;
    border-radius: 14px;
    aspect-ratio: 9 / 16;
  }
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
