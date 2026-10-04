<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { NoticeDto, WalletDto } from '@rabbithole/shared';
  import { onMount, type Snippet } from 'svelte';
  import { api, onMutation } from '../../api';
  import { t } from '../../i18n';
  import { loadSession, logout, session } from '../../session.svelte';
  import { ui } from '../../ui.svelte';
  import Bell from './Bell.svelte';
  import Icon from './Icon.svelte';
  import { activeTab, BARE_ROUTES, NAV } from './nav';

  /**
   * Navigation du site : barre latérale sur PC, barre du bas (et « Plus ») sur téléphone, onglets des rubriques,
   * portefeuille et notifications. Masquée pendant une partie et sur les pages de connexion.
   */
  let { children }: { children: Snippet } = $props();

  let wide = $state(false);
  let moreOpen = $state(false);
  let wallet = $state.raw<WalletDto | null>(null);
  let notices = $state.raw<NoticeDto[]>([]);
  let incomingTrades = $state(0);

  const path = $derived(page.url.pathname);
  const bare = $derived(BARE_ROUTES.some((r) => path === r || path.startsWith(`${r}/`)));
  const current = $derived(activeTab(path));
  const hidden = $derived(bare || ui.immersive > 0);
  const user = $derived(session.user);
  const badges = $derived<Record<string, number>>({ social: incomingTrades, 'nav-trades': incomingTrades });

  async function refresh(): Promise<void> {
    if (!session.user) {
      wallet = null;
      notices = [];
      incomingTrades = 0;
      return;
    }
    const [w, n, tr] = await Promise.all([
      api.wallet().catch(() => null),
      api.notices().catch(() => null),
      api.trades().catch(() => null),
    ]);
    wallet = w?.wallet ?? null;
    notices = n ? n.notices.filter((x) => !x.read) : [];
    incomingTrades = tr?.incoming.length ?? 0;
  }

  // Une action réussie (achat, ouverture, échange…) peut changer le portefeuille : rafraîchissement groupé.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void refresh(), 300);
  };

  onMount(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const sync = () => (wide = media.matches);
    sync();
    media.addEventListener('change', sync);
    if (!session.loaded) void loadSession().then(refresh);
    const off = onMutation(soon);
    return () => {
      media.removeEventListener('change', sync);
      off();
    };
  });

  afterNavigate(() => {
    moreOpen = false;
    if (session.loaded) void refresh();
  });

  async function dismiss(n: NoticeDto): Promise<void> {
    notices = notices.filter((x) => x.id !== n.id);
    await api.readNotice(n.id).catch(() => {});
  }

  async function readAll(): Promise<void> {
    notices = [];
    await api.readNotice().catch(() => {});
  }

  async function signOut(): Promise<void> {
    moreOpen = false;
    await logout();
    await goto('/');
  }
</script>

{#snippet walletPill()}
  {#if wallet}
    <a class="wallet" href="/shop" data-testid="shell-wallet" aria-label={t('wallet')}>
      <span title={t('coins')}>🪙 {wallet.coins.toLocaleString()}</span>
      <span title={t('gems')}>💎 {wallet.gems.toLocaleString()}</span>
    </a>
  {/if}
{/snippet}

{#snippet bell(side: 'left' | 'right')}
  {#if user}<Bell {notices} {side} ondismiss={dismiss} onall={readAll} />{/if}
{/snippet}

<!-- La page reste toujours au même endroit : masquer la navigation ne doit pas recréer la page (ni la partie en cours). -->
<div class="shell" class:wide={wide && !hidden} class:hidden>
  {#if hidden}
    <!-- Plein écran : pas de navigation. -->
  {:else if wide}
      <aside class="sidebar">
        <div class="brand">
          <a class="logo" href="/"><span class="rabbit">🐇</span> <span class="word">RABBIT</span><span class="word accent">HOLE</span></a>
          {@render bell('left')}
        </div>
        <nav class="groups" aria-label={t('nav_main')}>
          {#each NAV as g (g.id)}
            <a class="item" class:active={current?.group.id === g.id} href={g.href} data-testid="group-{g.id}" aria-current={current?.group.id === g.id ? 'page' : undefined}>
              <Icon name={g.icon} />
              <span class="label">{t(g.label)}</span>
              {#if badges[g.id]}<span class="badge">{badges[g.id]}</span>{:else if current?.group.id === g.id}<span class="dot"></span>{/if}
            </a>
          {/each}
        </nav>
        <div class="foot">
          {#if user}
            <span class="me">{user.displayName}</span>
            <button class="item small" onclick={signOut}><Icon name="logout" size={18} /> <span>{t('logout')}</span></button>
          {:else if session.loaded}
            <a class="btn btn-primary" href="/signup">{t('signup')}</a>
            <a class="btn" href="/login">{t('login')}</a>
          {/if}
        </div>
      </aside>
      <div class="corner">{@render walletPill()}</div>
  {:else}
      <header class="topbar">
        <a class="logo" href="/"><span class="rabbit">🐇</span></a>
        <div class="right">
          {@render walletPill()}
          {@render bell('right')}
          {#if session.loaded && !user}<a class="btn small-btn" href="/login">{t('login')}</a>{/if}
        </div>
      </header>
    {/if}

    <div class="content">
      {#if !hidden && current && current.group.tabs.length > 1}
        <nav class="tabs" aria-label={t(current.group.label)}>
          {#each current.group.tabs as tab (tab.href)}
            <a href={tab.href} class:active={current.tab?.href === tab.href} data-testid={tab.testid} aria-current={current.tab?.href === tab.href ? 'page' : undefined}>
              {t(tab.label)}{#if badges[tab.testid]}<span class="badge">{badges[tab.testid]}</span>{/if}
            </a>
          {/each}
        </nav>
      {/if}
      {@render children()}
    </div>

    {#if !wide && !hidden}
      <nav class="bottombar" aria-label={t('nav_main')}>
        {#each NAV.filter((g) => g.mobile) as g (g.id)}
          <a class:active={current?.group.id === g.id} href={g.href} data-testid="group-{g.id}">
            <span class="ico"><Icon name={g.icon} />{#if badges[g.id]}<span class="badge mini">{badges[g.id]}</span>{/if}</span>
            <span>{t(g.label)}</span>
          </a>
        {/each}
        <button class:active={moreOpen || (current !== null && !current.group.mobile)} onclick={() => (moreOpen = !moreOpen)} data-testid="nav-more">
          <span class="ico"><Icon name="more" /></span>
          <span>{t('nav_more')}</span>
        </button>
      </nav>
      {#if moreOpen}
        <div class="sheet-backdrop" role="presentation" onclick={() => (moreOpen = false)}>
          <div class="sheet more" role="dialog" aria-modal="true" aria-label={t('nav_more')} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (moreOpen = false)}>
            {#each NAV.filter((g) => !g.mobile) as g (g.id)}
              <a class="item" class:active={current?.group.id === g.id} href={g.href} data-testid="group-{g.id}"><Icon name={g.icon} /> <span>{t(g.label)}</span></a>
            {/each}
            {#if user}
              <button class="item" onclick={signOut}><Icon name="logout" /> <span>{t('logout')}</span></button>
            {:else if session.loaded}
              <a class="item" href="/signup"><span>{t('signup')}</span></a>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
</div>

<style>
  .shell {
    min-height: 100%;
  }
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--text);
    text-decoration: none;
    font-weight: 800;
    font-size: 20px;
    letter-spacing: 0.02em;
  }
  .logo .rabbit {
    font-size: 24px;
    margin-right: 6px;
  }
  .logo .accent {
    color: var(--accent);
    margin-left: 4px;
  }

  /* PC : barre latérale. */
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: 248px;
    display: flex;
    flex-direction: column;
    padding: 20px 16px;
    background: var(--bg-2);
    border-right: 1px solid var(--line);
    z-index: 30;
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2px 22px;
  }
  .groups {
    display: grid;
    gap: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    font-size: 15px;
    background: none;
    text-align: left;
  }
  .item:hover {
    background: color-mix(in srgb, var(--panel) 70%, transparent);
  }
  .item.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .item .label {
    flex: 1;
  }
  .item.small {
    padding: 8px 10px;
    font-size: 14px;
    color: var(--muted);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .badge {
    display: inline-block;
    min-width: 20px;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    line-height: 20px;
    text-align: center;
  }
  .foot {
    margin-top: auto;
    display: grid;
    gap: 8px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .foot .me {
    padding: 0 10px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .corner {
    position: fixed;
    top: 14px;
    right: 18px;
    z-index: 25;
  }
  .wide .content {
    margin-left: 248px;
    padding-top: 8px;
  }

  /* Portefeuille. */
  .wallet {
    display: inline-flex;
    gap: 10px;
    padding: 6px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--panel) 85%, transparent);
    border: 1px solid var(--line);
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
  }

  /* Onglets d'une rubrique. */
  .tabs {
    display: flex;
    justify-content: center;
    gap: 6px;
    max-width: 760px;
    margin: 0 auto;
    padding: 12px 16px 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs a {
    flex: none;
    padding: 8px 14px;
    border-radius: 999px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 700;
    font-size: 14px;
    border: 1px solid transparent;
  }
  .tabs a.active {
    color: var(--text);
    background: var(--panel);
    border-color: var(--line);
  }

  /* Téléphone : barre du haut et barre du bas. */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 25;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: max(8px, env(safe-area-inset-top)) 14px 8px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
  }
  .topbar .right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .small-btn {
    padding: 6px 12px;
    font-size: 13px;
    text-decoration: none;
    color: var(--text);
  }
  .shell:not(.wide):not(.hidden) .content {
    padding-bottom: calc(72px + env(safe-area-inset-bottom));
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .shell:not(.wide) .tabs {
    justify-content: flex-start;
    padding-top: 4px;
  }
  .bottombar {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    background: var(--bg-2);
    border-top: 1px solid var(--line);
  }
  .bottombar a,
  .bottombar button {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 6px 2px;
    color: var(--muted);
    text-decoration: none;
    font-size: 12px;
    font-weight: 600;
    background: none;
  }
  .bottombar .active {
    color: var(--accent);
  }
  .ico {
    position: relative;
    display: grid;
  }
  .badge.mini {
    position: absolute;
    top: -6px;
    right: -14px;
    min-width: 18px;
    line-height: 18px;
    font-size: 11px;
    margin: 0;
  }
  .sheet.more {
    display: grid;
    gap: 4px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
  }
</style>
