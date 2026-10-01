<script lang="ts">
  import { goto } from '$app/navigation';
  import { CATEGORY_NAMES, type CardDef } from '@rabbithole/engine';
  import type { DeckDto } from '@rabbithole/shared';
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { CATEGORY_STYLE } from '$lib/game/theme';
  import { loc, locale, t } from '$lib/i18n';
  import { loadSession, session } from '$lib/session.svelte';
  import MiniCard from '$lib/ui/MiniCard.svelte';

  let { data } = $props();
  // Le catalogue est lu une fois : il ne change pas pendant la vie de la page.
  const { ctx, collectible } = untrack(() => data.catalog);
  const { deckSize, maxCopiesPerCard } = ctx.rules;

  interface Draft {
    id: string | null;
    name: string;
    leaderId: string | null;
    cards: Map<string, number>;
  }

  let decks = $state.raw<DeckDto[]>([]);
  let owned = $state.raw(new Map<string, number>());
  let draft = $state.raw<Draft | null>(null);
  let errors = $state<string[]>([]);
  let notice = $state<string | null>(null);
  let busy = $state(false);

  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const ownedLeaders = $derived(Object.values(ctx.cards).filter((c) => c.type === 'leader' && (owned.get(c.id) ?? 0) > 0));
  const leader = $derived(draft?.leaderId ? ctx.cards[draft.leaderId] : undefined);
  const eligible = $derived(
    leader
      ? Object.values(ctx.cards)
          .filter((c) => c.type !== 'leader' && collectible.has(c.id) && (owned.get(c.id) ?? 0) > 0 && c.categories.some((x) => leader.categories.includes(x)))
          .sort((a, b) => a.cost - b.cost || b.power - a.power)
      : [],
  );
  const count = $derived(draft ? [...draft.cards.values()].reduce((a, b) => a + b, 0) : 0);
  const deckList = $derived(
    draft
      ? [...draft.cards.entries()]
          .map(([id, n]) => ({ def: ctx.cards[id]!, n }))
          .filter((x) => x.def)
          .sort((a, b) => a.def.cost - b.def.cost)
      : [],
  );

  async function refresh(): Promise<void> {
    const [d, c] = await Promise.all([api.decks(), api.collection()]);
    decks = d.decks;
    owned = new Map(c.cards.map((x) => [x.cardId, x.quantity]));
  }

  onMount(() => {
    void (async () => {
      const user = session.loaded ? session.user : await loadSession();
      if (!user) return goto('/login?next=/decks');
      await refresh();
    })();
  });

  const limit = (id: string) => Math.min(owned.get(id) ?? 0, maxCopiesPerCard);

  function edit(deck: DeckDto | null): void {
    errors = [];
    notice = null;
    const cards = new Map<string, number>();
    for (const id of deck?.cardIds ?? []) cards.set(id, (cards.get(id) ?? 0) + 1);
    draft = { id: deck?.id ?? null, name: deck?.name ?? t('new_deck'), leaderId: deck?.leaderId ?? ownedLeaders[0]?.id ?? null, cards };
  }

  function update(fn: (d: Draft) => void): void {
    if (!draft) return;
    const next = { ...draft, cards: new Map(draft.cards) };
    fn(next);
    draft = next;
  }

  function setLeader(id: string): void {
    // Changer de Leader retire les cartes qui ne partagent plus aucune catégorie.
    update((d) => {
      d.leaderId = id;
      const cats = ctx.cards[id]!.categories;
      for (const cardId of [...d.cards.keys()]) if (!ctx.cards[cardId]!.categories.some((c) => cats.includes(c))) d.cards.delete(cardId);
    });
  }

  const add = (def: CardDef) =>
    update((d) => {
      const n = d.cards.get(def.id) ?? 0;
      if (n < limit(def.id) && count < deckSize) d.cards.set(def.id, n + 1);
    });

  const remove = (id: string) =>
    update((d) => {
      const n = d.cards.get(id) ?? 0;
      if (n <= 1) d.cards.delete(id);
      else d.cards.set(id, n - 1);
    });

  /** Complète avec les cartes compatibles possédées, des moins chères aux plus chères. */
  const autoFill = () =>
    update((d) => {
      let total = [...d.cards.values()].reduce((a, b) => a + b, 0);
      for (const def of eligible) {
        while (total < deckSize && (d.cards.get(def.id) ?? 0) < limit(def.id)) {
          d.cards.set(def.id, (d.cards.get(def.id) ?? 0) + 1);
          total += 1;
        }
      }
    });

  async function save(): Promise<void> {
    if (!draft?.leaderId) return;
    busy = true;
    errors = [];
    notice = null;
    const input = { name: draft.name.trim() || t('new_deck'), leaderId: draft.leaderId, cardIds: [...draft.cards.entries()].flatMap(([id, n]) => Array(n).fill(id) as string[]) };
    try {
      const { deck } = draft.id ? await api.updateDeck(draft.id, input) : await api.createDeck(input);
      draft = { ...draft, id: deck.id };
      notice = t('saved');
      await refresh();
    } catch (e) {
      errors = e instanceof ApiError && Array.isArray(e.body.errors) ? (e.body.errors as string[]) : [t('err_generic')];
    } finally {
      busy = false;
    }
  }

  async function destroy(): Promise<void> {
    if (!draft?.id || !confirm(t('delete_confirm'))) return;
    await api.deleteDeck(draft.id);
    draft = null;
    await refresh();
  }
</script>

<main>
  <header class="top">
    <button class="icon" aria-label={t('back')} onclick={() => (draft ? (draft = null) : goto('/'))}>←</button>
    <h1>{t('decks')}</h1>
    <a class="link" href="/collection">{t('collection')} →</a>
  </header>

  {#if !draft}
    {#if ownedLeaders.length === 0}
      <p class="panel">{t('no_leader')} <a href="/collection">{t('collection')}</a></p>
    {/if}
    <div class="decks">
      {#each decks as deck (deck.id)}
        {@const l = ctx.cards[deck.leaderId]}
        <button class="deck" onclick={() => edit(deck)}>
          <strong>{deck.name}</strong>
          <span class="leader-name">{t('leader')} : {loc(l?.name)}</span>
          <span class="muted">{t('deck_count', { n: deck.cardIds.length, max: deckSize })}</span>
        </button>
      {/each}
      <button class="deck new" disabled={ownedLeaders.length === 0} data-testid="new-deck" onclick={() => edit(null)}>+ {t('new_deck')}</button>
    </div>
  {:else}
    <div class="editor">
      <section class="panel side">
        <label class="field">{t('deck_name')}<input bind:value={draft.name} maxlength="40" data-testid="deck-name" /></label>
        <h3>{t('choose_leader')}</h3>
        <div class="leaders">
          {#each ownedLeaders as l (l.id)}
            <div class="leader-pick">
              <MiniCard {ctx} defId={l.id} selected={draft.leaderId === l.id} onclick={() => setLeader(l.id)} />
            </div>
          {/each}
        </div>
        {#if leader}
          <p class="chips">
            {#each leader.categories as c (c)}<span class="chip" style:--c={hex(CATEGORY_STYLE[c].color)}>{CATEGORY_STYLE[c].glyph} {CATEGORY_NAMES[c][locale]}</span>{/each}
          </p>
        {/if}
        <h3 class:full={count === deckSize} data-testid="deck-count">{t('deck_count', { n: count, max: deckSize })}</h3>
        <ul class="list">
          {#each deckList as { def, n } (def.id)}
            <li><button onclick={() => remove(def.id)}><span class="cost">{def.cost}</span> {loc(def.name)} <strong>×{n}</strong> <span class="minus">−</span></button></li>
          {/each}
        </ul>
        <div class="actions">
          <button class="btn" disabled={!leader || count >= deckSize} data-testid="auto-fill" onclick={autoFill}>{t('auto_fill')}</button>
          <button class="btn btn-primary" disabled={busy || !leader} data-testid="save-deck" onclick={save}>{t('save')}</button>
        </div>
        {#if notice}<p class="ok" role="status">{notice}</p>{/if}
        {#each errors as err, i (i)}<p class="error">{err}</p>{/each}
        {#if draft.id}<button class="btn danger" onclick={destroy}>{t('delete')}</button>{/if}
      </section>
      <section>
        <h3>{t('eligible_cards')}</h3>
        <div class="grid">
          {#each eligible as def (def.id)}
            {@const n = draft.cards.get(def.id) ?? 0}
            <div class="pick" class:maxed={n >= limit(def.id)}>
              <MiniCard {ctx} defId={def.id} count={owned.get(def.id) ?? 0} onclick={() => add(def)} />
              {#if n > 0}<span class="in">{n}/{limit(def.id)}</span>{/if}
            </div>
          {/each}
        </div>
      </section>
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 40px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  h1 {
    margin: 0;
    flex: 1;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 15px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  h3.full {
    color: var(--win);
  }
  .icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    font-weight: 700;
  }
  .link,
  .panel a {
    color: var(--accent);
    font-weight: 700;
  }
  .panel {
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 16px;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .decks {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  }
  .deck {
    text-align: left;
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    border-radius: 16px;
    background: var(--bg-2);
    border: 2px solid var(--line);
  }
  .deck.new {
    place-items: center;
    border-style: dashed;
    color: var(--accent);
    font-weight: 700;
    min-height: 80px;
  }
  .leader-name {
    color: var(--accent);
    font-size: 14px;
    font-weight: 700;
  }
  .editor {
    display: grid;
    gap: 16px;
  }
  @media (min-width: 900px) {
    .editor {
      grid-template-columns: 360px 1fr;
      align-items: start;
    }
    .side {
      position: sticky;
      top: 12px;
    }
  }
  .field {
    display: grid;
    gap: 4px;
    color: var(--muted);
    font-size: 14px;
  }
  .field input {
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .leaders {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }
  .chips {
    display: flex;
    gap: 6px;
    margin: 8px 0 0;
  }
  .chip {
    font-size: 12px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    color: var(--c);
    border: 1px solid var(--c);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
    max-height: 340px;
    overflow-y: auto;
  }
  .list button {
    width: 100%;
    display: flex;
    gap: 8px;
    align-items: center;
    text-align: left;
    background: var(--panel);
    border-radius: 10px;
    padding: 6px 10px;
  }
  .cost {
    background: var(--mana);
    color: #06131f;
    border-radius: 50%;
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
    flex: none;
  }
  .minus {
    margin-left: auto;
    color: var(--lose);
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .actions .btn {
    flex: 1;
  }
  .danger {
    margin-top: 12px;
    width: 100%;
    color: var(--lose);
    border-color: var(--lose);
  }
  .ok {
    color: var(--win);
    font-weight: 700;
  }
  .error {
    color: var(--lose);
    margin: 6px 0 0;
    font-size: 14px;
  }
  .grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }
  .pick {
    position: relative;
  }
  .pick.maxed {
    opacity: 0.5;
  }
  .in {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent);
    color: white;
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 12px;
    font-weight: 700;
  }
</style>
