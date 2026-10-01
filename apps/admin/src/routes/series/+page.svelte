<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorMessage, type SeriesRow } from '$lib/api';

  let rows = $state.raw<SeriesRow[]>([]);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);
  let id = $state('');
  let type = $state('base');
  let country = $state('');
  let nameFr = $state('');
  let nameEn = $state('');

  const STATUS: Record<string, string> = { draft: 'Brouillon', review: 'Relecture', published: 'Publiée' };

  async function load(): Promise<void> {
    rows = (await api.series()).series;
  }
  onMount(() => void load().catch((err: unknown) => (error = errorMessage(err))));

  async function create(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = message = null;
    try {
      await api.createSeries({ id, type, country: type === 'country' ? country.toUpperCase() : null, name: { fr: nameFr, en: nameEn } });
      id = nameFr = nameEn = country = '';
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function setStatus(s: SeriesRow, status: SeriesRow['status']): Promise<void> {
    if (status === 'published' && !confirm(`Publier la série ${s.id} ? Ses ${s.published} cartes publiées deviennent jouables et obtenables.`)) return;
    error = message = null;
    try {
      const res = await api.seriesStatus(s.id, status);
      message = `Série ${s.id} : ${STATUS[status]}. Catalogue ${res.catalogVersion}.`;
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<h1>Séries</h1>
{#if error}<p class="error">{error}</p>{/if}
{#if message}<p class="notice">{message}</p>{/if}

<table>
  <thead><tr><th>Série</th><th>Type</th><th>Pays</th><th>Cartes</th><th>Statut</th><th></th></tr></thead>
  <tbody>
    {#each rows as s (s.id)}
      <tr>
        <td><a href="/cards?series={s.id}"><strong>{s.name.fr ?? s.id}</strong></a><br /><span class="muted">{s.id}</span></td>
        <td>{s.type}</td>
        <td>{s.country ?? '—'}</td>
        <td>{s.published} publiées / {s.cards}</td>
        <td>{STATUS[s.status] ?? s.status}</td>
        <td class="row">
          {#if s.type !== 'prototype' && s.type !== 'tokens'}
            {#if s.status !== 'published'}<button class="primary" onclick={() => setStatus(s, 'published')}>Publier</button>{/if}
            {#if s.status === 'published'}<button class="danger" onclick={() => setStatus(s, 'draft')}>Dépublier</button>{/if}
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<h2>Nouvelle série</h2>
<form class="panel row" onsubmit={create}>
  <input placeholder="identifiant (ex. base_01, fr_01)" pattern="[a-z0-9_]{'{2,40}'}" required bind:value={id} />
  <select bind:value={type}>
    <option value="base">Set de base</option>
    <option value="world">Série mondiale</option>
    <option value="country">Série pays</option>
  </select>
  {#if type === 'country'}<input placeholder="Pays (FR)" maxlength="2" required bind:value={country} style="width: 90px" />{/if}
  <input placeholder="Nom (fr)" required bind:value={nameFr} />
  <input placeholder="Nom (en)" required bind:value={nameEn} />
  <button class="primary" type="submit">Créer</button>
</form>
<p class="muted">Une carte publiée n'est jouable que si sa série est publiée. Dépublier une série retire toutes ses cartes du jeu.</p>
