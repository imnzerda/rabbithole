<script lang="ts">
  import type { NoticeDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { loc, t } from '$lib/i18n';

  /** Notifications non lues du joueur (ex. carte retirée du jeu et compensée en pièces). */
  let notices = $state.raw<NoticeDto[]>([]);

  onMount(() => {
    api
      .notices()
      .then((r) => (notices = r.notices.filter((n) => !n.read)))
      .catch(() => {});
  });

  function text(n: NoticeDto): string {
    if (n.kind === 'card_retired') {
      const p = n.payload as { name: Record<string, string>; quantity: number; coins: number };
      return t('notice_card_retired', { name: loc(p.name), coins: p.coins, n: p.quantity });
    }
    return '';
  }

  async function dismiss(n: NoticeDto): Promise<void> {
    notices = notices.filter((x) => x.id !== n.id);
    await api.readNotice(n.id).catch(() => {});
  }
</script>

{#each notices.filter((n) => text(n)) as n (n.id)}
  <div class="notice" role="status" data-testid="notice">
    <span>{text(n)}</span>
    <button class="btn" onclick={() => dismiss(n)}>{t('notice_ok')}</button>
  </div>
{/each}

<style>
  .notice {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    margin: 12px 0;
    padding: 12px 16px;
    border: 1px solid var(--accent);
    border-radius: 14px;
    background: var(--bg-2);
  }
  .notice span {
    flex: 1 1 220px;
  }
</style>
