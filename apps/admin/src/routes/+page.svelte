<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorMessage } from '$lib/api';

  let data = $state<{ counts: Record<string, number>; catalogVersion: string } | null>(null);
  let error = $state<string | null>(null);

  const LABELS: [string, string, string][] = [
    ['candidates', 'Candidats importés', '/candidates'],
    ['shortlisted', 'Candidats retenus', '/candidates?status=shortlisted'],
    ['candidates_to_review', 'Candidats à revoir (politique)', '/candidates?policy=needs_review'],
    ['drafts', 'Cartes en brouillon', '/cards?status=draft'],
    ['in_review', 'Cartes en relecture', '/cards?status=review'],
    ['policy_pending', 'Cartes en attente de validation (politique)', '/cards'],
    ['published', 'Cartes publiées', '/cards?status=published'],
  ];

  onMount(async () => {
    try {
      data = await api.overview();
    } catch (err) {
      error = errorMessage(err);
    }
  });
</script>

<h1>Tableau de bord</h1>
{#if error}<p class="error">{error}</p>{/if}
{#if data}
  <div class="grid">
    {#each LABELS as [key, label, href] (key)}
      <a class="panel stat" {href}>
        <span class="n">{data.counts[key] ?? 0}</span>
        <span class="muted">{label}</span>
      </a>
    {/each}
  </div>
  <p class="muted">Catalogue joué : <code>{data.catalogVersion}</code></p>
  <h2>Méthode</h2>
  <ol class="muted">
    <li>Lancer le pipeline (<code>pnpm --filter @rabbithole/pipeline pipeline all --series base_01</code>) puis importer <code>tools/pipeline/out/base_01.json</code> dans <a href="/candidates">Candidats</a>.</li>
    <li>Retenir les candidats, puis créer leur carte (brouillon prérempli : nom, catégories, image créditée).</li>
    <li>Régler stats, effets et textes dans l'éditeur ; le budget de puissance signale les cartes hors norme.</li>
    <li>Valider la politique de contenu des cartes « à revoir », passer en relecture, publier. Publier ensuite la série.</li>
  </ol>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .stat {
    display: grid;
    gap: 4px;
    text-decoration: none;
    color: var(--text);
  }
  .n {
    font-size: 30px;
    font-weight: 700;
  }
</style>
