<script lang="ts">
  import { goto } from '$app/navigation';
  import type { FriendDto, FriendsDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';

  let friends = $state.raw<FriendsDto | null>(null);
  let target = $state('');
  let message = $state<{ text: string; error: boolean } | null>(null);
  let busy = $state(false);
  let copied = $state(false);

  async function refresh(): Promise<void> {
    friends = await api.friends();
  }

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/friends');
      await refresh();
    })();
  });

  const KNOWN_ERRORS = ['player_not_found', 'ambiguous_name', 'self', 'already_friends', 'already_requested', 'too_many_requests'] as const;

  async function run(fn: () => Promise<string | void>): Promise<void> {
    busy = true;
    message = null;
    try {
      const ok = await fn();
      if (ok) message = { text: ok, error: false };
    } catch (e) {
      const code = e instanceof ApiError ? KNOWN_ERRORS.find((k) => k === e.code) : undefined;
      message = { text: code ? t(`err_${code}`) : t('err_generic'), error: true };
    } finally {
      busy = false;
      await refresh().catch(() => {});
    }
  }

  // Un code ami : 8 caractères hexadécimaux ; sinon, c'est un pseudo.
  const addFriend = () =>
    run(async () => {
      const value = target.trim();
      if (!value) return;
      const r = await api.addFriend(/^[0-9a-f]{8}$/i.test(value) ? { code: value } : { name: value });
      target = '';
      return t(r.accepted ? 'friend_added' : 'friend_requested', { name: r.name });
    });

  const copyCode = async () => {
    if (!friends) return;
    await navigator.clipboard?.writeText(friends.code).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  };

  const removeFriend = (f: FriendDto) => {
    if (confirm(t('remove_friend_confirm', { name: f.name }))) void run(() => api.removeFriend(f.id).then(() => undefined));
  };
</script>

<main>
  <header class="top">
    <h1>{t('friends')}</h1>
  </header>

  {#if message}<p class:error={message.error} class:ok={!message.error} role="status" data-testid="message">{message.text}</p>{/if}

  {#if friends}
    <section class="panel">
      <h2>{t('friend_code')}</h2>
      <p class="muted">{t('friend_code_hint')}</p>
      <div class="code-row">
        <code data-testid="friend-code">{friends.code}</code>
        <button class="btn" onclick={copyCode}>{copied ? t('copied') : t('copy')}</button>
      </div>
      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          void addFriend();
        }}
      >
        <label class="sr-only" for="friend-target">{t('add_friend')}</label>
        <input id="friend-target" data-testid="friend-target" placeholder={t('add_friend_placeholder')} maxlength="40" bind:value={target} />
        <button class="btn btn-primary" disabled={busy || !target.trim()} data-testid="add-friend">{t('add')}</button>
      </form>
    </section>

    {#if friends.incoming.length}
      <section class="panel highlight">
        <h2>{t('requests_in')}</h2>
        {#each friends.incoming as f (f.id)}
          <div class="row">
            <span class="name">{f.name}</span>
            <button class="btn btn-primary" disabled={busy} data-testid="accept-friend" onclick={() => run(() => api.acceptFriend(f.id).then(() => t('friend_added', { name: f.name })))}>
              {t('accept')}
            </button>
            <button class="btn" disabled={busy} onclick={() => run(() => api.removeFriend(f.id).then(() => undefined))}>{t('decline')}</button>
          </div>
        {/each}
      </section>
    {/if}

    <section class="panel">
      <h2>{t('my_friends')}</h2>
      {#if friends.friends.length === 0}
        <p class="muted">{t('no_friends')}</p>
      {/if}
      {#each friends.friends as f (f.id)}
        <div class="row" data-testid="friend">
          <span class="name">{f.name}</span>
          <a class="btn btn-primary" href="/trades?with={f.id}" data-testid="propose-trade">{t('propose_trade')}</a>
          <button class="btn" disabled={busy} onclick={() => removeFriend(f)}>{t('remove_friend')}</button>
        </div>
      {/each}
      {#if friends.outgoing.length}
        <h3>{t('requests_out')}</h3>
        {#each friends.outgoing as f (f.id)}
          <div class="row">
            <span class="name muted">{f.name}</span>
            <button class="btn" disabled={busy} onclick={() => run(() => api.removeFriend(f.id).then(() => undefined))}>{t('cancel')}</button>
          </div>
        {/each}
      {/if}
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 900px;
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
    margin: 0 0 6px;
    font-size: 20px;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 16px;
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
    margin: 0 0 10px;
  }
  .error {
    color: var(--lose);
    font-weight: 700;
  }
  .ok {
    color: var(--win);
    font-weight: 700;
  }
  .code-row,
  .add,
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .add {
    margin-top: 14px;
  }
  .add input {
    flex: 1 1 200px;
    min-width: 0;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--text);
    font-size: 16px;
  }
  code {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.15em;
    background: var(--panel);
    border: 1px dashed var(--accent);
    border-radius: 12px;
    padding: 6px 14px;
  }
  .row {
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .name {
    flex: 1 1 140px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
