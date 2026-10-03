<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { CATEGORIES, CATEGORY_NAMES, KEYWORDS, KEYWORD_NAMES, RARITIES, type CardDef, type CategoryId, type KeywordId } from '@rabbithole/engine';
  import { api, errorMessage, type CardDetail, type CardStatus, type Preview } from '$lib/api';

  const LANGS = ['fr', 'en', 'es', 'pt', 'de'] as const;
  const PRINTABLE = KEYWORDS.filter((k) => k !== 'tendance');
  const TRANSITIONS: Record<CardStatus, { to: CardStatus; label: string; danger?: boolean }[]> = {
    draft: [
      { to: 'review', label: 'Passer en relecture' },
      { to: 'retired', label: 'Retirer', danger: true },
    ],
    review: [
      { to: 'published', label: 'Publier' },
      { to: 'draft', label: 'Revenir en brouillon' },
      { to: 'retired', label: 'Retirer', danger: true },
    ],
    published: [{ to: 'retired', label: 'Retirer du jeu', danger: true }],
    retired: [{ to: 'draft', label: 'Remettre en brouillon' }],
  };
  const STATUS: Record<CardStatus, string> = { draft: 'Brouillon', review: 'Relecture', published: 'Publiée', retired: 'Retirée' };

  const cardId = page.params.id ?? '';
  let detail = $state.raw<CardDetail | null>(null);
  let def = $state<CardDef | null>(null);
  let effectsJson = $state('[]');
  let jsonError = $state<string | null>(null);
  let live = $state.raw<Preview | null>(null);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let dirty = $state(false);

  async function load(): Promise<void> {
    detail = await api.card(cardId);
    def = structuredClone(detail.def);
    def.flavor ??= {};
    def.flags ??= {};
    effectsJson = JSON.stringify(detail.def.effects, null, 2);
    live = detail;
    dirty = false;
  }

  onMount(() => {
    void load().catch((err: unknown) => (error = errorMessage(err)));
  });

  // Effets en JSON : appliqués dès qu'ils sont lisibles.
  function onEffects(): void {
    try {
      const parsed: unknown = JSON.parse(effectsJson);
      if (!Array.isArray(parsed)) throw new Error('une liste d’effets est attendue');
      if (def) def.effects = parsed as CardDef['effects'];
      jsonError = null;
    } catch (err) {
      jsonError = (err as Error).message;
    }
  }

  // Aperçu en direct (validation du moteur, budget, texte), 300 ms après la dernière modification.
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (!def) return;
    const snapshot = $state.snapshot(def) as CardDef;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void api.preview(snapshot).then((p) => (live = p), () => {});
    }, 300);
  });

  function touch(): void {
    dirty = true;
    message = null;
  }

  function setCategory(i: 0 | 1, value: string): void {
    if (!def) return;
    const cats = [...def.categories];
    if (value) cats[i] = value as CategoryId;
    else cats.splice(i, 1);
    def.categories = [...new Set(cats.filter(Boolean))];
    touch();
  }

  function toggleKeyword(k: KeywordId, on: boolean): void {
    if (!def) return;
    def.keywords = on ? [...def.keywords, k] : def.keywords.filter((x) => x !== k);
    touch();
  }

  async function save(): Promise<void> {
    if (!def || jsonError) return;
    error = message = null;
    try {
      const res = await api.saveCard(cardId, $state.snapshot(def) as CardDef);
      message = `Enregistré (version ${res.version}).${res.status === 'published' ? ' Catalogue mis à jour.' : ''}`;
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function setStatus(to: CardStatus): Promise<void> {
    if (dirty) {
      error = 'Enregistre d’abord tes modifications.';
      return;
    }
    error = message = null;
    try {
      await api.cardStatus(cardId, to);
      message = `Statut : ${STATUS[to]}.`;
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  /** Enlever la carte : effacée si elle n'a jamais été publiée, sinon retirée du jeu. */
  async function remove(): Promise<void> {
    if (!confirm('Enlever cette carte ? Jamais publiée : elle est effacée. Déjà publiée : elle est retirée du jeu et ses détenteurs reçoivent son prix de fabrication en pièces.')) return;
    error = message = null;
    try {
      const { result } = await api.removeCard(cardId);
      if (result === 'deleted') await goto('/cards');
      else {
        message = 'Carte retirée du jeu (déjà publiée : elle ne peut pas être effacée). Ses détenteurs ont reçu son prix de fabrication en pièces et une notification.';
        await load();
      }
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function toggleImage(imageId: string, active: boolean): Promise<void> {
    try {
      await api.imageActive(cardId, imageId, active);
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  const verdictClass = (v?: string) => (v === 'ok' ? 'ok' : 'warn');
</script>

<p><a href="/cards">← Cartes</a></p>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if message}<p class="notice" role="status">{message}</p>{/if}

{#if detail && def}
  <div class="head row">
    <h1>{def.name.fr ?? def.id}</h1>
    <span class="tag">{STATUS[detail.status]}</span>
    <span class="muted">{detail.id} · série {detail.series} · v{detail.version}</span>
    {#if def.wikidataId}<a href="https://www.wikidata.org/wiki/{def.wikidataId}" target="_blank" rel="noreferrer">{def.wikidataId}</a>{/if}
  </div>

  <div class="layout">
    <form class="panel editor" oninput={touch} onsubmit={(e) => (e.preventDefault(), save())}>
      <fieldset disabled={detail.status === 'retired'}>
        <div class="grid">
          <label>Type
            <select bind:value={def.type}>
              <option value="character">Personnage</option>
              <option value="event">Événement</option>
              <option value="leader">Leader</option>
            </select>
          </label>
          <label>Rareté
            <select bind:value={def.rarity}>{#each RARITIES as r (r)}<option value={r}>{r}</option>{/each}</select>
          </label>
          <label>Catégorie 1
            <select value={def.categories[0] ?? ''} onchange={(e) => setCategory(0, e.currentTarget.value)}>
              {#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_NAMES[c].fr}</option>{/each}
            </select>
          </label>
          <label>Catégorie 2
            <select value={def.categories[1] ?? ''} onchange={(e) => setCategory(1, e.currentTarget.value)}>
              <option value="">—</option>
              {#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_NAMES[c].fr}</option>{/each}
            </select>
          </label>
          <label>Coût <input type="number" min="0" max="10" bind:value={def.cost} /></label>
          <label>Puissance <input type="number" min="0" max="20" bind:value={def.power} /></label>
          {#if def.type === 'character'}<label>Contre <input type="number" min="0" max="3" bind:value={def.counter} /></label>{/if}
          {#if def.type === 'leader'}<label>Vies <input type="number" min="1" max="8" bind:value={def.life} /></label>{/if}
          <label>Pays <input maxlength="2" bind:value={def.country} placeholder="FR" /></label>
        </div>

        <h2>Nom et texte d'ambiance</h2>
        <div class="langs">
          {#each LANGS as l (l)}
            <span class="lang">{l}</span>
            <input placeholder="Nom ({l})" bind:value={def.name[l]} />
            <input placeholder="Texte d'ambiance ({l}) : décalé, jamais dégradant" bind:value={def.flavor![l]} />
          {/each}
        </div>

        <h2>Mots-clés</h2>
        <div class="row">
          {#each PRINTABLE as k (k)}
            <label class="check"><input type="checkbox" checked={def.keywords.includes(k)} onchange={(e) => toggleKeyword(k, e.currentTarget.checked)} /> {KEYWORD_NAMES[k].fr}</label>
          {/each}
        </div>

        <h2>Effets (DSL JSON, section 3.7)</h2>
        <textarea rows="10" bind:value={effectsJson} oninput={onEffects} spellcheck="false"></textarea>
        {#if jsonError}<p class="error">JSON : {jsonError}</p>{/if}

        <h2>Drapeaux</h2>
        <div class="row">
          <label class="check"><input type="checkbox" bind:checked={def.flags!.adult} /> Adulte (filtré par pays)</label>
          <label class="check"><input type="checkbox" bind:checked={def.flags!.sensitive} /> Contenu sensible (masquable par le joueur)</label>
          <label class="check"><input type="checkbox" bind:checked={def.flags!.politicallySensitive} /> Politiquement sensible</label>
          <label class="check">
            <input type="checkbox" checked={def.image?.fallback ?? true} onchange={(e) => ((def!.image = { assetId: def!.image?.assetId ?? null, fallback: e.currentTarget.checked }), touch())} />
            Carte typographique (sans image)
          </label>
        </div>

        <div class="row save">
          <button class="primary" type="submit" disabled={!!jsonError || !dirty} data-testid="save">Enregistrer</button>
          {#if dirty}<span class="muted">Modifications non enregistrées</span>{/if}
        </div>
      </fieldset>
    </form>

    <aside>
      <section class="panel">
        <h2>Statut</h2>
        <div class="row">
          {#each TRANSITIONS[detail.status] as t (t.to)}
            <button class:primary={t.to === 'published'} class:danger={t.danger} onclick={() => setStatus(t.to)}>{t.label}</button>
          {/each}
          {#if detail.status !== 'retired'}<button class="danger" onclick={remove} data-testid="remove-card">Supprimer</button>{/if}
        </div>
      </section>

      <section class="panel">
        <h2>Validation et budget</h2>
        {#if live?.errors.length}
          <ul class="error">{#each live.errors as e (e)}<li>{e}</li>{/each}</ul>
        {:else if live?.budget}
          <p>
            <span class="tag {verdictClass(live.budget.verdict)}">{live.budget.verdict}</span>
            {def.type === 'character' ? 'Puissance attendue' : 'Valeur attendue'} <strong>{live.budget.expected}</strong>,
            réelle <strong>{live.budget.actual}</strong> (écart {live.budget.delta > 0 ? '+' : ''}{live.budget.delta})
          </p>
          <table class="budget">
            <tbody>
              {#each live.budget.lines as line (line.label)}<tr><td>{line.label}</td><td class="num">{line.value > 0 ? '+' : ''}{line.value}</td></tr>{/each}
            </tbody>
          </table>
        {/if}
        {#if live?.text.length}
          <h2>Texte de la carte</h2>
          {#each live.text as line, i (i)}<p class="cardtext">{#if line.keyword}<strong>{line.keyword}</strong> — {/if}{line.text}</p>{/each}
        {/if}
      </section>

      <section class="panel">
        <h2>Politique de contenu</h2>
        <p>
          <span class="tag {detail.policy.status === 'ok' ? 'ok' : detail.policy.status === 'excluded' ? 'bad' : 'warn'}">{detail.policy.status}</span>
          {#each detail.policy.reasons as r, i (i)}<span class="tag">{r}</span>{/each}
        </p>
        <p class="muted">Pour information : seul un sujet exclu (personne mineure aujourd'hui) bloque la publication.</p>
      </section>

      <section class="panel">
        <h2>Images et crédits</h2>
        {#each detail.images as img (img.id)}
          <div class="img row" class:dim={!img.active}>
            <img src={img.source_url} alt="" />
            <div>
              <div>{img.author}</div>
              <div class="muted">{img.license}{img.personality_warning ? ' · droits de la personnalité' : ''}</div>
              <a href={img.file_page} target="_blank" rel="noreferrer">Fiche Commons</a>
              <div>
                {#if img.active}<button class="danger" onclick={() => toggleImage(img.id, false)}>Retirer l'image</button>
                {:else}<button onclick={() => toggleImage(img.id, true)}>Rétablir</button>{/if}
              </div>
            </div>
          </div>
        {:else}
          <p class="muted">Aucune image : carte typographique.</p>
        {/each}
      </section>
    </aside>
  </div>
{/if}

<style>
  .head {
    margin-bottom: 12px;
  }
  .head h1 {
    margin: 0;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr);
    gap: 16px;
    align-items: start;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  label {
    display: grid;
    gap: 3px;
    color: var(--muted);
    font-size: 13px;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
  }
  .langs {
    display: grid;
    grid-template-columns: 28px 1fr 2fr;
    gap: 6px;
    align-items: center;
  }
  .lang {
    color: var(--muted);
    text-transform: uppercase;
    font-size: 12px;
  }
  textarea {
    width: 100%;
  }
  .save {
    margin-top: 14px;
  }
  aside {
    display: grid;
    gap: 12px;
  }
  aside h2 {
    margin-top: 0;
  }
  .budget td {
    padding: 2px 4px;
    border: 0;
  }
  .num {
    text-align: right;
    font-family: var(--mono);
  }
  .cardtext {
    margin: 4px 0;
  }
  .img {
    align-items: flex-start;
    margin-bottom: 10px;
  }
  .img img {
    width: 72px;
    height: 90px;
    object-fit: cover;
    border-radius: 8px;
  }
  .dim {
    opacity: 0.45;
  }
  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
