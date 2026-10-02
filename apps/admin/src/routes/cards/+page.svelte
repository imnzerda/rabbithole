<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { CATEGORY_NAMES, type CardDef } from '@rabbithole/engine';
  import { api, errorMessage, type CardRow, type SeriesRow } from '$lib/api';

  let series = $state.raw<SeriesRow[]>([]);
  let rows = $state.raw<CardRow[]>([]);
  let filterSeries = $state(page.url.searchParams.get('series') ?? '');
  let filterStatus = $state(page.url.searchParams.get('status') ?? '');
  let q = $state('');
  let error = $state<string | null>(null);

  let newSeries = $state('');
  let newType = $state<CardDef['type']>('character');
  let newName = $state('');
  let importReport = $state<string | null>(null);

  /** Lot de brouillons : fichier JSON { series, cards } (ex. tools/pipeline/drafts/base_01.json). */
  async function importFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    error = importReport = null;
    try {
      const data = JSON.parse(await file.text()) as { series: string; cards: unknown[] };
      const res = await api.importDrafts(data.series, data.cards);
      importReport = `${res.created.length} brouillon(s) créé(s) dans ${data.series}.` + (res.skipped.length ? ` Ignorées : ${res.skipped.map((x) => `${x.id} (${x.reason})`).join(', ')}.` : '');
      await load();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      input.value = '';
    }
  }

  const STATUS: Record<string, string> = { draft: 'Brouillon', review: 'Relecture', published: 'Publiée', retired: 'Retirée' };
  const verdictClass = (v?: string) => (v === 'ok' ? 'ok' : v ? 'warn' : 'bad');

  async function load(): Promise<void> {
    try {
      rows = (await api.cards({ series: filterSeries, status: filterStatus, q })).cards;
    } catch (err) {
      error = errorMessage(err);
    }
  }

  onMount(async () => {
    series = (await api.series()).series;
    newSeries = series.find((s) => s.type !== 'prototype' && s.type !== 'tokens')?.id ?? '';
    await load();
  });

  /** Carte sans sujet Wikidata (mème, concept, événement de jeu) : relecture humaine obligatoire. */
  async function create(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    try {
      const { card } = await api.createCard(newSeries, newType, newName);
      await goto(`/cards/${encodeURIComponent(card.id)}`);
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<h1>Cartes <span class="muted">({rows.length})</span></h1>
{#if error}<p class="error">{error}</p>{/if}
{#if importReport}<p class="notice">{importReport}</p>{/if}

<div class="row bar">
  <select bind:value={filterSeries} onchange={load}>
    <option value="">Toutes séries</option>
    {#each series as s (s.id)}<option value={s.id}>{s.id}</option>{/each}
  </select>
  <select bind:value={filterStatus} onchange={load}>
    <option value="">Tous statuts</option>
    {#each Object.entries(STATUS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
  </select>
  <form class="row" onsubmit={(e) => (e.preventDefault(), load())}>
    <input placeholder="Nom ou identifiant" bind:value={q} />
    <button type="submit">Chercher</button>
  </form>
  <span class="grow"></span>
  <label class="panel file">Importer des brouillons (JSON) <input type="file" accept=".json,application/json" onchange={importFile} data-testid="import-drafts" /></label>
  <form class="row panel new" onsubmit={create}>
    <strong>Nouvelle carte</strong>
    <select bind:value={newSeries} required>
      {#each series as s (s.id)}<option value={s.id}>{s.id}</option>{/each}
    </select>
    <select bind:value={newType}>
      <option value="character">Personnage</option>
      <option value="event">Événement</option>
      <option value="leader">Leader</option>
    </select>
    <input placeholder="Nom" required bind:value={newName} />
    <button class="primary" type="submit">Créer</button>
  </form>
</div>

<table>
  <thead>
    <tr><th>Carte</th><th>Type</th><th>Rareté</th><th>Catégories</th><th>Coût / Puiss.</th><th>Budget</th><th>Politique</th><th>Statut</th></tr>
  </thead>
  <tbody>
    {#each rows as c (c.id)}
      <tr>
        <td><a href="/cards/{encodeURIComponent(c.id)}"><strong>{c.name}</strong></a><br /><span class="muted">{c.id} · {c.series}</span></td>
        <td>{c.type}</td>
        <td>{c.rarity}</td>
        <td>{c.categories.map((x) => CATEGORY_NAMES[x]?.fr ?? x).join(', ')}</td>
        <td>{c.cost} / {c.power}</td>
        <td><span class="tag {verdictClass(c.budget?.verdict)}">{c.budget ? `${c.budget.delta > 0 ? '+' : ''}${c.budget.delta} ${c.budget.verdict}` : 'invalide'}</span></td>
        <td>
          <span class="tag {c.policy === 'ok' || c.policyCleared ? 'ok' : c.policy === 'excluded' ? 'bad' : 'warn'}">
            {c.policy === 'needs_review' ? (c.policyCleared ? 'validée' : 'à valider') : c.policy}
          </span>
        </td>
        <td>{STATUS[c.status] ?? c.status}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .bar {
    margin-bottom: 12px;
  }
  .grow {
    flex: 1;
  }
  .new,
  .file {
    padding: 8px 10px;
  }
</style>
