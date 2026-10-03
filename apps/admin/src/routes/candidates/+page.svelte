<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { CATEGORIES, CATEGORY_NAMES, type CardDef } from '@rabbithole/engine';
  import { api, errorMessage, type CandidateRow, type SeriesRow } from '$lib/api';

  const PAGE = 50;
  const params = page.url.searchParams;
  let category = $state(params.get('category') ?? '');
  let status = $state(params.get('status') ?? '');
  let policy = $state(params.get('policy') ?? '');
  let q = $state('');
  let minScore = $state<number | undefined>(undefined);
  let offset = $state(0);

  let rows = $state.raw<CandidateRow[]>([]);
  let total = $state(0);
  let series = $state.raw<SeriesRow[]>([]);
  let targetSeries = $state('');
  let cardType = $state<CardDef['type']>('character');
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const REASONS: Record<string, string> = {
    minor_now: 'mineur aujourd’hui',
    listed_as_victim: 'cité comme victime',
    convicted: 'condamné',
    violent_death: 'mort violente',
    sensitive_death: 'overdose',
    adult_performer: 'Industrie X',
    sensitive_words: 'mots sensibles',
  };
  const reason = (r: string) => REASONS[r] ?? r;
  const policyClass = (s?: string) => (s === 'ok' ? 'ok' : s === 'excluded' ? 'bad' : 'warn');

  async function load(): Promise<void> {
    error = null;
    try {
      const res = await api.candidates({ category, status, policy, q, minScore, limit: PAGE, offset });
      rows = res.candidates;
      total = res.total;
    } catch (err) {
      error = errorMessage(err);
    }
  }

  function search(): void {
    offset = 0;
    void load();
  }

  onMount(async () => {
    series = (await api.series()).series.filter((s) => s.type !== 'prototype' && s.type !== 'tokens');
    targetSeries = series[0]?.id ?? '';
    await load();
  });

  async function importFile(e: Event): Promise<void> {
    // currentTarget n'existe plus après un await : on garde le champ.
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    message = error = null;
    try {
      const res = await api.importCandidates(JSON.parse(await file.text()));
      message = `Import : ${res.imported} nouveaux candidats, ${res.updated} mis à jour.`;
      await load();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
      input.value = '';
    }
  }

  async function setStatus(c: CandidateRow, s: 'new' | 'shortlisted' | 'rejected'): Promise<void> {
    try {
      await api.candidateStatus(c.qid, s);
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function makeCard(c: CandidateRow): Promise<void> {
    if (!targetSeries) {
      error = 'Crée d’abord une série (page Séries).';
      return;
    }
    try {
      const { card } = await api.cardFromCandidate(c.qid, targetSeries, cardType);
      await goto(`/cards/${encodeURIComponent(card.id)}`);
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<h1>Candidats <span class="muted">({total})</span></h1>

<div class="panel row toolbar">
  <label class="file">
    Importer un fichier du pipeline
    <input type="file" accept=".json,application/json" onchange={importFile} disabled={busy} data-testid="import" />
  </label>
  <span class="grow"></span>
  <label>Série cible
    <select bind:value={targetSeries}>
      {#each series as s (s.id)}<option value={s.id}>{s.id}</option>{/each}
    </select>
  </label>
  <label>Type
    <select bind:value={cardType}>
      <option value="character">Personnage</option>
      <option value="event">Événement</option>
      <option value="leader">Leader</option>
    </select>
  </label>
</div>
{#if message}<p class="notice">{message}</p>{/if}
{#if error}<p class="error">{error}</p>{/if}

<form class="row filters" onsubmit={(e) => (e.preventDefault(), search())}>
  <select bind:value={category} onchange={search}>
    <option value="">Toutes catégories</option>
    {#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_NAMES[c].fr}</option>{/each}
  </select>
  <select bind:value={status} onchange={search}>
    <option value="">Tous statuts</option>
    <option value="new">Nouveaux</option>
    <option value="shortlisted">Retenus</option>
    <option value="rejected">Rejetés</option>
    <option value="carded">Carte créée</option>
  </select>
  <select bind:value={policy} onchange={search}>
    <option value="">Toute politique</option>
    <option value="ok">OK</option>
    <option value="needs_review">À revoir</option>
    <option value="excluded">Exclus</option>
  </select>
  <input placeholder="Score min." type="number" min="0" max="100" style="width: 110px" bind:value={minScore} />
  <input placeholder="Nom ou Q-id" bind:value={q} />
  <button type="submit">Filtrer</button>
</form>

<table>
  <thead>
    <tr><th></th><th>Sujet</th><th>Catégories</th><th>Notoriété</th><th>Politique</th><th>Image</th><th>Statut</th><th></th></tr>
  </thead>
  <tbody>
    {#each rows as c (c.qid)}
      <tr class:dim={c.status === 'rejected' || c.policy?.status === 'excluded'}>
        <td class="thumb">{#if c.image?.thumb && c.image.accepted}<img src={c.image.thumb} alt="" loading="lazy" />{/if}</td>
        <td>
          <strong>{c.name}</strong>
          <a class="muted" href="https://www.wikidata.org/wiki/{c.qid}" target="_blank" rel="noreferrer">{c.qid}</a><br />
          <span class="muted">{c.description}</span>
          {#if c.countries.length}<span class="muted"> · {c.countries.join(', ')}</span>{/if}
        </td>
        <td>{c.categories.map((x) => CATEGORY_NAMES[x]?.fr ?? x).join(', ')}</td>
        <td>
          <strong>{c.score?.total ?? '—'}</strong>
          {#if c.score?.iconic}<span class="tag ok">iconique</span>{/if}
          {#if c.score && !c.score.meetsThreshold}<span class="tag warn">sous le seuil</span>{/if}<br />
          <span class="muted">{c.sitelinks} langues · {c.viewsYear?.toLocaleString('fr-FR') ?? '—'} vues/an (est.)</span>
        </td>
        <td>
          <span class="tag {policyClass(c.policy?.status)}">{c.policy?.status ?? '—'}</span>
          {#each c.policy?.reasons ?? [] as r, i (i)}<br /><span class="muted">{reason(r)}</span>{/each}
          {#if c.flags.adult}<br /><span class="tag bad">adulte</span>{/if}
          {#if c.flags.sensitive}<br /><span class="tag warn">sensible</span>{/if}
        </td>
        <td>
          {#if c.image}<span class="tag {c.image.accepted ? 'ok' : 'bad'}">{c.image.license}</span>{:else}<span class="muted">typographique</span>{/if}
        </td>
        <td>{c.status}</td>
        <td class="actions">
          {#if c.status === 'carded' && c.cardId}
            <a href="/cards/{encodeURIComponent(c.cardId)}">Ouvrir la carte</a>
          {:else if c.policy?.status !== 'excluded'}
            {#if c.status !== 'shortlisted'}<button onclick={() => setStatus(c, 'shortlisted')}>Retenir</button>{/if}
            {#if c.status !== 'rejected'}<button onclick={() => setStatus(c, 'rejected')}>Rejeter</button>{/if}
            <button class="primary" onclick={() => makeCard(c)}>Créer la carte</button>
          {/if}
        </td>
      </tr>
    {:else}
      <tr><td colspan="8" class="muted">Aucun candidat. Importe un fichier <code>tools/pipeline/out/&lt;série&gt;.json</code>.</td></tr>
    {/each}
  </tbody>
</table>

<div class="row pager">
  <button disabled={offset === 0} onclick={() => ((offset = Math.max(0, offset - PAGE)), load())}>Précédents</button>
  <span class="muted">{total ? offset + 1 : 0}–{Math.min(offset + PAGE, total)} sur {total}</span>
  <button disabled={offset + PAGE >= total} onclick={() => ((offset += PAGE), load())}>Suivants</button>
</div>

<style>
  .toolbar {
    margin-bottom: 10px;
  }
  .toolbar label {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .grow {
    flex: 1;
  }
  .filters {
    margin: 10px 0;
  }
  .thumb {
    width: 56px;
  }
  .thumb img {
    width: 48px;
    height: 60px;
    object-fit: cover;
    border-radius: 6px;
  }
  .dim {
    opacity: 0.5;
  }
  .actions {
    white-space: nowrap;
  }
  .actions button {
    margin: 0 4px 4px 0;
  }
  .pager {
    margin-top: 12px;
  }
</style>
