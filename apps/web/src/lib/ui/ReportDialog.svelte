<script lang="ts">
  import { api, ApiError } from '../api';
  import { t, type I18nKey } from '../i18n';

  /** Signaler une carte, ou l'adversaire d'une partie en ligne. */
  type Target = { type: 'card'; cardId: string } | { type: 'player'; matchId: string };
  interface Props {
    target: Target;
    onclose: () => void;
  }
  let { target, onclose }: Props = $props();

  const CARD_REASONS = ['offensive', 'inaccurate', 'minor', 'victim', 'copyright', 'privacy', 'other'] as const;
  const PLAYER_REASONS = ['harassment', 'cheating', 'name', 'other'] as const;
  const reasons = $derived(target.type === 'card' ? CARD_REASONS : PLAYER_REASONS);

  let reason = $state('');
  let details = $state('');
  let sent = $state(false);
  let error = $state<string | null>(null);
  let pending = $state(false);

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    pending = true;
    error = null;
    try {
      await api.report(target, reason, details);
      sent = true;
    } catch (err) {
      error = err instanceof ApiError && err.code === 'too_many_reports' ? t('err_too_many_reports') : t('err_generic');
    } finally {
      pending = false;
    }
  }
</script>

<div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="sheet report" role="dialog" aria-modal="true" aria-label={t('report')} data-testid="report-dialog">
    {#if sent}
      <h2>{t('report_thanks')}</h2>
      <p>{t('report_thanks_text')}</p>
      <button class="btn btn-primary" onclick={onclose}>{t('close')}</button>
    {:else}
      <h2>{target.type === 'card' ? t('report_card') : t('report_player')}</h2>
      <form onsubmit={submit}>
        <label>
          {t('report_reason')}
          <select required bind:value={reason} data-testid="report-reason">
            <option value="" disabled>—</option>
            {#each reasons as r (r)}<option value={r}>{t(`report_reason_${r}` as I18nKey)}</option>{/each}
          </select>
        </label>
        <label>
          {t('report_details')}
          <textarea rows="3" maxlength="1000" bind:value={details}></textarea>
        </label>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="actions">
          <button class="btn" type="button" onclick={onclose}>{t('cancel')}</button>
          <button class="btn btn-primary" type="submit" disabled={pending || !reason} data-testid="report-send">{t('report_send')}</button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .report {
    max-width: 420px;
  }
  form {
    display: grid;
    gap: 12px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 14px;
    color: var(--muted);
  }
  select,
  textarea {
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .error {
    color: var(--lose);
    font-weight: 700;
    margin: 0;
  }
</style>
