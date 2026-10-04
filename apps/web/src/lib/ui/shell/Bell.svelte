<script lang="ts">
  import type { NoticeDto } from '@rabbithole/shared';
  import { t } from '../../i18n';
  import { noticeText } from '../../notices';
  import Icon from './Icon.svelte';

  /** Cloche des notifications : nombre de non lues, liste au clic (OK = lue). */
  interface Props {
    notices: NoticeDto[];
    /** Côté où s'ouvre la liste. */
    side: 'left' | 'right';
    ondismiss: (n: NoticeDto) => void;
    onall: () => void;
  }
  let { notices, side, ondismiss, onall }: Props = $props();
  let open = $state(false);
  const shown = $derived(notices.filter((n) => noticeText(n)));
</script>

<div class="bell-wrap">
  <button class="bell" aria-label={t('notifications')} aria-expanded={open} onclick={() => (open = !open)} data-testid="bell">
    <Icon name="bell" size={20} />
    {#if shown.length}<span class="count" data-testid="bell-count">{shown.length}</span>{/if}
  </button>
  {#if open}
    <button class="scrim" aria-label={t('close')} onclick={() => (open = false)}></button>
    <div class="panel {side}" role="dialog" aria-label={t('notifications')}>
      <div class="head">
        <strong>{t('notifications')}</strong>
        {#if shown.length}<button class="link" onclick={onall}>{t('notices_all_read')}</button>{/if}
      </div>
      {#each shown as n (n.id)}
        <div class="notice" role="status" data-testid="notice">
          <span>{noticeText(n)}</span>
          <button class="btn" onclick={() => ondismiss(n)}>{t('notice_ok')}</button>
        </div>
      {:else}
        <p class="empty">{t('notices_empty')}</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bell-wrap {
    position: relative;
  }
  .bell {
    position: relative;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: none;
    color: var(--muted);
  }
  .bell:hover {
    color: var(--text);
  }
  .count {
    position: absolute;
    top: 2px;
    right: 0;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--lose);
    color: #fff;
    font-size: 11px;
    font-weight: 800;
    line-height: 18px;
    text-align: center;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: transparent;
  }
  .panel {
    position: absolute;
    top: 46px;
    z-index: 41;
    width: min(360px, calc(100vw - 32px));
    max-height: 70vh;
    overflow: auto;
    padding: 12px;
    border-radius: 16px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.5);
  }
  .panel.left {
    left: 0;
  }
  .panel.right {
    right: 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .link {
    background: none;
    color: var(--accent);
    font-size: 13px;
  }
  .notice {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    border-top: 1px solid var(--line);
    font-size: 14px;
  }
  .notice span {
    flex: 1;
  }
  .empty {
    margin: 8px 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
