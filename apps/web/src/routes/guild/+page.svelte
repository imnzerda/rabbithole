<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORY_NAMES, type CategoryId } from '@rabbithole/engine';
  import type { GuildMemberDto, GuildSummaryDto, MyGuildDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { errorText, loc, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';

  /** Guildes (section 13) : recherche, création, adhésion ; ma guilde (membres, demandes, rôles, réglages). */
  let mine = $state.raw<MyGuildDto | null>(null);
  let results = $state.raw<GuildSummaryDto[]>([]);
  let query = $state('');
  let language = $state('');
  let message = $state<string | null>(null);
  let busy = $state(false);
  let creating = $state(false);
  let editing = $state(false);
  let form = $state({ name: '', description: '', emblem: 'internet', language: 'fr', open: true });

  const EMBLEMS = Object.keys(CATEGORY_NAMES) as CategoryId[];
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const emblemStyle = (e: string) => {
    const s = CATEGORY_STYLE[e as CategoryId];
    return s ? `--c: ${hex(s.color)}` : '';
  };
  const glyph = (e: string) => CATEGORY_STYLE[e as CategoryId]?.glyph ?? '★';

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/guild');
      mine = await api.myGuild();
      if (!mine.guild) await search();
    })();
  });

  async function search(): Promise<void> {
    results = (await api.guilds(query, language).catch(() => ({ guilds: [] }))).guilds;
  }

  async function call(fn: () => Promise<MyGuildDto>, done?: string): Promise<void> {
    busy = true;
    message = null;
    try {
      mine = await fn();
      if (done) message = done;
      if (!mine.guild) await search();
    } catch (e) {
      message = e instanceof ApiError ? errorText(e.code) : t('err_generic');
    } finally {
      busy = false;
    }
  }

  async function join(g: GuildSummaryDto): Promise<void> {
    await call(async () => {
      const r = await api.guildJoin(g.id);
      message = r.status === 'joined' ? t('guild_joined', { name: g.name }) : t('guild_requested', { name: g.name });
      return r;
    });
  }

  function startEdit(): void {
    const g = mine!.guild!;
    form = { name: g.name, description: g.description, emblem: g.emblem, language: g.language, open: g.open };
    editing = true;
  }

  async function leave(): Promise<void> {
    if (confirm(t('guild_leave_confirm'))) await call(() => api.guildLeave(), t('guild_left'));
  }

  async function kick(m: GuildMemberDto): Promise<void> {
    if (confirm(t('guild_kick_confirm', { name: m.name }))) await call(() => api.guildKick(m.userId));
  }

  async function transfer(m: GuildMemberDto): Promise<void> {
    if (confirm(t('guild_transfer_confirm', { name: m.name }))) await call(() => api.guildRole(m.userId, 'leader'));
  }

  const you = $derived(mine?.guild?.you ?? null);
  const canKick = (m: GuildMemberDto) => !m.you && (you === 'leader' || (you === 'officer' && m.role === 'member'));
</script>

{#snippet emblem(e: string, size = 44)}
  <span class="emblem" style="{emblemStyle(e)}; --s: {size}px" aria-hidden="true">{glyph(e)}</span>
{/snippet}

{#snippet settingsForm(withName: boolean, submit: () => void, cancel: () => void)}
  <form
    class="form"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    {#if withName}
      <label><span>{t('guild_name')}</span><input bind:value={form.name} minlength="3" maxlength="24" required data-testid="guild-name" /></label>
    {/if}
    <label><span>{t('guild_description')}</span><textarea bind:value={form.description} maxlength="200" rows="2" data-testid="guild-description"></textarea></label>
    <div class="field">
      <span>{t('guild_emblem')}</span>
      <div class="emblems" role="radiogroup" aria-label={t('guild_emblem')}>
        {#each EMBLEMS as e (e)}
          <button type="button" role="radio" aria-checked={form.emblem === e} aria-label={loc(CATEGORY_NAMES[e])} class="pick" class:active={form.emblem === e} onclick={() => (form.emblem = e)}>
            {@render emblem(e, 36)}
          </button>
        {/each}
      </div>
    </div>
    <label>
      <span>{t('guild_language')}</span>
      <select bind:value={form.language}>
        {#each mine?.languages ?? [] as l (l)}<option value={l}>{t(`lang_${l as 'fr'}`)}</option>{/each}
      </select>
    </label>
    <label class="check"><input type="checkbox" bind:checked={form.open} /> <span>{t('guild_open_label')}</span></label>
    <div class="actions">
      <button class="btn btn-primary" disabled={busy} data-testid="guild-submit">
        {withName ? t('guild_create_for', { n: mine?.creationCoins ?? 0 }) : t('guild_save')}
      </button>
      <button type="button" class="btn" onclick={cancel}>{t('cancel')}</button>
    </div>
  </form>
{/snippet}

<main>
  <header class="top">
    <h1>{t('guild_title')}</h1>
  </header>
  {#if message}<p class="message" data-testid="message">{message}</p>{/if}

  {#if mine?.guild}
    {@const g = mine.guild}
    <section class="panel highlight" data-testid="my-guild">
      <div class="head">
        {@render emblem(g.emblem, 64)}
        <div>
          <h2>{g.name}</h2>
          <p class="muted small">
            {t('guild_level', { n: g.level })} · {t('guild_members', { n: g.members, max: g.capacity })} · {t(`lang_${g.language as 'fr'}`)} · {g.open ? t('guild_open') : t('guild_closed')}
          </p>
        </div>
      </div>
      {#if g.description}<p class="description">{g.description}</p>{/if}
      {#if editing}
        {@render settingsForm(false, () => call(() => api.guildSettings({ description: form.description, emblem: form.emblem, language: form.language, open: form.open }), t('guild_saved')).then(() => (editing = false)), () => (editing = false))}
      {:else}
        <div class="actions">
          {#if g.you === 'leader'}<button class="btn" onclick={startEdit} data-testid="guild-edit">{t('guild_edit')}</button>{/if}
          <button class="btn" disabled={busy} onclick={leave} data-testid="guild-leave">{t('guild_leave')}</button>
        </div>
      {/if}
    </section>

    {#if g.requests.length}
      <section class="panel">
        <h2>{t('guild_requests', { n: g.requests.length })}</h2>
        <ul class="list">
          {#each g.requests as r (r.userId)}
            <li data-testid="guild-request">
              <strong>{r.name}</strong>
              <span class="row-actions">
                <button class="btn btn-primary small-btn" disabled={busy} onclick={() => call(() => api.guildDecide(r.userId, true))} data-testid="guild-accept">{t('accept')}</button>
                <button class="btn small-btn" disabled={busy} onclick={() => call(() => api.guildDecide(r.userId, false))}>{t('decline')}</button>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="panel">
      <h2>{t('guild_roster')}</h2>
      <ul class="list" data-testid="guild-roster">
        {#each g.roster as m (m.userId)}
          <li class:you={m.you}>
            <span class="who"><strong>{m.name}</strong> <span class="role {m.role}">{t(`guild_role_${m.role}`)}</span></span>
            {#if you === 'leader' && !m.you}
              <span class="row-actions">
                {#if m.role === 'member'}<button class="btn small-btn" disabled={busy} onclick={() => call(() => api.guildRole(m.userId, 'officer'))}>{t('guild_promote')}</button>{/if}
                {#if m.role === 'officer'}<button class="btn small-btn" disabled={busy} onclick={() => call(() => api.guildRole(m.userId, 'member'))}>{t('guild_demote')}</button>{/if}
                <button class="btn small-btn" disabled={busy} onclick={() => transfer(m)}>{t('guild_transfer')}</button>
              </span>
            {/if}
            {#if canKick(m)}<button class="btn small-btn danger" disabled={busy} onclick={() => kick(m)}>{t('guild_kick')}</button>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else if mine}
    {#if creating}
      <section class="panel highlight">
        <h2>{t('guild_create')}</h2>
        {@render settingsForm(
          true,
          () => call(() => api.guildCreate({ ...form }), t('guild_created')).then(() => (creating = false)),
          () => (creating = false),
        )}
      </section>
    {:else}
      <p class="muted intro">{t('guild_hint')}</p>
      <button class="btn btn-primary create" onclick={() => (creating = true)} data-testid="guild-create">{t('guild_create_for', { n: mine.creationCoins })}</button>
    {/if}

    <section class="panel">
      <h2>{t('guild_find')}</h2>
      <form
        class="search"
        onsubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input bind:value={query} placeholder={t('guild_search_placeholder')} maxlength="40" data-testid="guild-search" />
        <select bind:value={language} onchange={() => void search()}>
          <option value="">{t('guild_all_languages')}</option>
          {#each mine.languages as l (l)}<option value={l}>{t(`lang_${l as 'fr'}`)}</option>{/each}
        </select>
        <button class="btn">{t('search')}</button>
      </form>
      {#if results.length === 0}<p class="muted">{t('guild_none')}</p>{/if}
      <ul class="results">
        {#each results as g (g.id)}
          {@const pending = mine.pending.includes(g.id)}
          <li data-testid="guild-result">
            {@render emblem(g.emblem)}
            <div class="info">
              <strong>{g.name}</strong>
              <span class="muted small">{t('guild_level', { n: g.level })} · {t('guild_members', { n: g.members, max: g.capacity })} · {t(`lang_${g.language as 'fr'}`)}</span>
              {#if g.description}<span class="small">{g.description}</span>{/if}
            </div>
            {#if pending}
              <button class="btn small-btn" disabled={busy} onclick={() => call(() => api.guildCancel(g.id))}>{t('guild_cancel_request')}</button>
            {:else}
              <button class="btn btn-primary small-btn" disabled={busy || g.members >= g.capacity} onclick={() => join(g)} data-testid="guild-join">
                {g.members >= g.capacity ? t('guild_full') : g.open ? t('guild_join') : t('guild_ask')}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

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
  .intro {
    margin-top: 12px;
  }
  .message {
    margin: 12px 0 0;
    font-weight: 700;
  }
  .create {
    margin-top: 12px;
    width: 100%;
  }
  .emblem {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: var(--s);
    height: var(--s);
    border-radius: 30%;
    background: color-mix(in srgb, var(--c, var(--accent)) 30%, transparent);
    border: 2px solid var(--c, var(--accent));
    color: var(--c, var(--accent));
    font-size: calc(var(--s) * 0.5);
    font-weight: 800;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .head h2 {
    margin: 0 0 4px;
  }
  .description {
    margin: 12px 0 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }
  .list,
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 6px;
    border-top: 1px solid var(--line);
  }
  .list li.you {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-radius: 10px;
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .small-btn {
    padding: 6px 12px;
    font-size: 13px;
  }
  .danger {
    color: var(--lose);
  }
  .role {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--panel);
    color: var(--muted);
  }
  .role.leader {
    color: var(--accent);
  }
  .results li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 4px;
    border-top: 1px solid var(--line);
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .search {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .search input {
    flex: 1;
    min-width: 140px;
  }
  input,
  select,
  textarea {
    padding: 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: inherit;
    font: inherit;
  }
  .form {
    display: grid;
    gap: 12px;
    margin-top: 12px;
  }
  .form label,
  .field {
    display: grid;
    gap: 6px;
    font-size: 14px;
  }
  .form .check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .emblems {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pick {
    padding: 3px;
    border-radius: 12px;
    background: none;
    border: 2px solid transparent;
  }
  .pick.active {
    border-color: var(--text, #fff);
  }
</style>
