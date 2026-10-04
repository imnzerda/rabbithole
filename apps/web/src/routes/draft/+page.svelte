<script lang="ts">
  import { goto } from '$app/navigation';
  import type { DraftDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { errorText, locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import CardInfo from '$lib/ui/CardInfo.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  /**
   * Draft du week-end (section 7) : choix du Leader, puis d'une carte par proposition jusqu'au deck complet,
   * puis parties jusqu'à N victoires ou M défaites. Tout est décidé par le serveur ; la page affiche et envoie les choix.
   */
  let { data } = $props();
  const { ctx } = untrack(() => data.catalog);

  let draft = $state.raw<DraftDto | null>(null);
  let detail = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/draft');
      draft = await api.draft().catch(() => null);
    })();
  });

  const run = $derived(draft?.run ?? null);
  const active = $derived(run && run.status !== 'done' ? run : null);
  // Choix du Leader, puis des cartes : ce qui est proposé maintenant.
  const choices = $derived(active?.status === 'picking' ? (active.leader ? active.offer : active.leaderChoices) : []);
  const picked = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const id of run?.picks ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts];
  });

  async function call(fn: () => Promise<{ draft: DraftDto }>): Promise<void> {
    busy = true;
    message = null;
    try {
      draft = (await fn()).draft;
    } catch (e) {
      message = e instanceof ApiError ? errorText(e.code) : t('err_generic');
    } finally {
      busy = false;
    }
  }

  async function retire(): Promise<void> {
    if (!confirm(t('draft_retire_confirm'))) return;
    await call(async () => {
      const r = await api.draftRetire();
      message = t('draft_retired', { n: r.reward.coins });
      return r;
    });
  }

  const opensAt = $derived(draft?.opensAt ? new Date(draft.opensAt).toLocaleString(locale, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '');
</script>

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => goto('/')}>←</button>
    <h1>{t('draft_title')}</h1>
  </header>
  {#if draft}<p class="muted intro">{t('draft_hint', { w: draft.maxWins, l: draft.maxLosses })}</p>{/if}
  {#if message}<p class="message" data-testid="message">{message}</p>{/if}

  {#if draft}
    {#if active?.status === 'picking'}
      <section class="panel highlight">
        <h2>{active.leader ? t('draft_pick', { n: active.picks.length + 1, total: active.deckSize }) : t('draft_pick_leader')}</h2>
        <p class="muted small">{t('draft_pick_hint')}</p>
        <div class="offer" data-testid="draft-offer">
          {#each choices as id, i (`${id}:${i}`)}
            <div class="choice">
              <MiniCard {ctx} defId={id} onclick={() => (detail = id)} />
              <button class="btn btn-primary" disabled={busy} data-testid="draft-take" onclick={() => call(() => api.draftPick(id))}>{t('draft_take')}</button>
            </div>
          {/each}
        </div>
      </section>
    {:else if active?.status === 'playing'}
      <section class="panel highlight">
        <h2>{t('draft_record', { w: active.wins, l: active.losses })}</h2>
        <div class="pips" aria-hidden="true">
          {#each Array.from({ length: draft.maxWins }, (_, i) => i) as i (i)}<span class="pip win" class:on={i < active.wins}>🏆</span>{/each}
          <span class="sep"></span>
          {#each Array.from({ length: draft.maxLosses }, (_, i) => i) as i (i)}<span class="pip loss" class:on={i < active.losses}>💀</span>{/each}
        </div>
        <p class="muted small">{t('draft_play_hint', { w: draft.maxWins, l: draft.maxLosses })}</p>
        <a class="btn btn-primary play" href="/online?draft=1" data-testid="draft-play">{t('draft_play')}</a>
        <button class="link" disabled={busy} data-testid="draft-retire" onclick={retire}>{t('draft_retire')}</button>
      </section>
    {:else}
      {#if run?.status === 'done' && run.reward}
        <section class="panel" data-testid="draft-result">
          <h2>{t('draft_done', { w: run.wins, l: run.losses })}</h2>
          <p class="reward">+{run.reward.coins} 🪙{run.reward.freeBoosters ? ` · +${run.reward.freeBoosters} 🎁` : ''}</p>
        </section>
      {/if}
      <section class="panel highlight">
        {#if !draft.open}
          <p class="muted" data-testid="draft-closed">{t('draft_closed', { d: opensAt })}</p>
        {:else}
          <div class="entries">
            {#if draft.freeLeft > 0}
              <button class="btn btn-primary" disabled={busy} data-testid="draft-free" onclick={() => call(() => api.draftStart('free'))}>{t('draft_enter_free')}</button>
            {/if}
            <button class="btn" class:btn-primary={draft.freeLeft === 0} disabled={busy} data-testid="draft-coins" onclick={() => call(() => api.draftStart('coins'))}>
              {t('draft_enter_coins', { n: draft.entryCoins })}
            </button>
          </div>
        {/if}
      </section>
    {/if}

    {#if active?.leader}
      <section class="panel">
        <h2>{t('draft_deck', { n: active.picks.length, total: active.deckSize })}</h2>
        <div class="grid" data-testid="draft-picks">
          <div class="leader"><MiniCard {ctx} defId={active.leader} onclick={() => (detail = active.leader)} /></div>
          {#each picked as [id, n] (id)}<MiniCard {ctx} defId={id} count={n} onclick={() => (detail = id)} />{/each}
        </div>
      </section>
    {/if}

    <section class="panel">
      <h2>{t('draft_rewards')}</h2>
      <ol class="rewards">
        {#each draft.rewards as r, wins (wins)}
          <li class:you={active?.status === 'playing' && active.wins === wins}>
            <span>{t('draft_wins', { n: wins })}</span>
            <strong>{r.coins} 🪙{r.freeBoosters ? ` + ${r.freeBoosters} 🎁` : ''}</strong>
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
    margin: 0 0 8px;
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
  .intro {
    margin-top: 10px;
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
  .message {
    margin: 12px 0 0;
    font-weight: 700;
  }
  .offer {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  .choice {
    display: grid;
    gap: 8px;
  }
  .entries {
    display: grid;
    gap: 10px;
  }
  .play {
    display: block;
    margin-top: 14px;
    text-align: center;
  }
  .link {
    display: block;
    margin: 12px auto 0;
    background: none;
    border: none;
    color: var(--muted);
    text-decoration: underline;
  }
  .pips {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 22px;
    margin: 6px 0 10px;
  }
  .pip {
    opacity: 0.2;
    filter: grayscale(1);
  }
  .pip.on {
    opacity: 1;
    filter: none;
  }
  .sep {
    width: 14px;
  }
  .reward {
    font-size: 20px;
    font-weight: 800;
    margin: 0;
  }
  .grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  }
  .leader {
    outline: 2px solid var(--accent);
    border-radius: 10px;
  }
  .rewards {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .rewards li {
    display: flex;
    justify-content: space-between;
    padding: 8px 6px;
    border-top: 1px solid var(--line);
  }
  .rewards li.you {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-radius: 10px;
  }
  .close {
    margin-top: 16px;
    width: 100%;
  }
</style>
