<script lang="ts">
  import { onMount } from 'svelte';
  import type { BudgetReport, SimulationResult } from '@rabbithole/engine';
  import { api, errorMessage } from '$lib/api';

  let budget = $state.raw<{ id: string; status: string; report: BudgetReport }[]>([]);
  let decks = $state.raw<{ id: string; name: Record<string, string>; leader: string; series: string }[]>([]);
  let onlyFlagged = $state(true);
  let a = $state('');
  let b = $state('');
  let games = $state(50);
  let includeDrafts = $state(false);
  let result = $state.raw<SimulationResult | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const shown = $derived(onlyFlagged ? budget.filter((x) => x.report.verdict !== 'ok') : budget);

  onMount(async () => {
    try {
      budget = (await api.budget()).cards;
      decks = (await api.decks()).decks;
      a = decks[0]?.id ?? '';
      b = decks[1]?.id ?? '';
    } catch (err) {
      error = errorMessage(err);
    }
  });

  async function simulate(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      result = await api.simulate({ a: { prebuilt: a }, b: { prebuilt: b }, games, includeDrafts });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)} %` : '—');
</script>

<h1>Équilibrage</h1>
{#if error}<p class="error">{error}</p>{/if}

<h2>Simulations IA contre IA</h2>
<form class="panel row" onsubmit={simulate}>
  <select bind:value={a}>{#each decks as d (d.id)}<option value={d.id}>{d.name.fr ?? d.id} ({d.series})</option>{/each}</select>
  <span>contre</span>
  <select bind:value={b}>{#each decks as d (d.id)}<option value={d.id}>{d.name.fr ?? d.id} ({d.series})</option>{/each}</select>
  <label>Parties <input type="number" min="2" max="200" bind:value={games} style="width: 80px" /></label>
  <label class="row"><input type="checkbox" bind:checked={includeDrafts} /> Inclure les brouillons</label>
  <button class="primary" type="submit" disabled={busy}>{busy ? 'Simulation…' : 'Simuler'}</button>
</form>
{#if result}
  <p>
    Deck A : <strong>{result.winsA}</strong> victoires ({pct(result.winsA, result.games)}) · Deck B : <strong>{result.winsB}</strong> ({pct(result.winsB, result.games)})
    · égalités {result.draws} · le premier joueur gagne {result.firstPlayerWinRate} % · {result.averageTurns} tours en moyenne
  </p>
{/if}
<p class="muted">Decks de référence des séries (importés sur la page Séries) et decks du prototype.</p>

<h2>Budget de puissance <span class="muted">({shown.length} / {budget.length})</span></h2>
<label class="row"><input type="checkbox" bind:checked={onlyFlagged} /> Seulement les cartes hors norme</label>
<table>
  <thead><tr><th>Carte</th><th>Statut</th><th>Référence</th><th>Attendu</th><th>Réel</th><th>Écart</th></tr></thead>
  <tbody>
    {#each shown as c (c.id)}
      <tr>
        <td><a href="/cards/{encodeURIComponent(c.id)}">{c.id}</a></td>
        <td>{c.status}</td>
        <td>{c.report.reference}</td>
        <td>{c.report.expected}</td>
        <td>{c.report.actual}</td>
        <td><span class="tag {c.report.verdict === 'ok' ? 'ok' : 'warn'}">{c.report.delta > 0 ? '+' : ''}{c.report.delta} {c.report.verdict}</span></td>
      </tr>
    {/each}
  </tbody>
</table>
