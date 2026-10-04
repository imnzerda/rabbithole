<script lang="ts">
  import type { TrendingCardDto } from '@rabbithole/shared';
  import { onMount } from 'svelte';
  import { api, errorMessage } from '$lib/api';

  /**
   * Tendance du jour (section 8) : calculée à 6 h UTC, publiée automatiquement à 6 h 30. Entre les deux (et
   * après), on peut écarter une carte dont la tendance vient d'un décès ou d'un drame. La liste de surveillance
   * exclut d'office des cartes des calculs suivants.
   */
  type Run = { computed_at: string; published_at: string | null } | null;
  let date = $state('');
  let run = $state.raw<Run>(null);
  let cards = $state.raw<TrendingCardDto[]>([]);
  let watchlist = $state.raw<{ cardId: string; reason: string }[]>([]);
  let newCard = $state('');
  let newReason = $state('');
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);

  const REASONS: Record<string, string> = { watchlist: 'liste de surveillance', recent_death: 'décès récent', admin: 'écartée par l’admin' };

  async function load(day?: string): Promise<void> {
    const r = await api.trending(day);
    date = r.date;
    run = r.run;
    cards = r.cards;
    watchlist = r.watchlist;
  }
  onMount(() => void load().catch((err: unknown) => (error = errorMessage(err))));

  async function act(fn: () => Promise<unknown>, done: string): Promise<void> {
    error = message = null;
    try {
      await fn();
      message = done;
      await load(date);
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<h1>Tendance du jour</h1>
<p class="muted">
  Vues Wikipédia de la veille (anglais + français) divisées par la moyenne des 30 jours précédents. Les 10 meilleures cartes au-dessus de 1 000 vues
  ont +1 puissance pendant 24 h. Calcul à 6 h UTC, publication automatique à 6 h 30 : écarter une carte liée à un décès ou à un drame.
</p>
{#if error}<p class="error">{error}</p>{/if}
{#if message}<p class="notice">{message}</p>{/if}

<p>
  <label>Jour <input type="date" value={date} onchange={(e) => void load((e.currentTarget as HTMLInputElement).value)} /></label>
  {#if run}
    · calculée le {new Date(run.computed_at).toLocaleString('fr-FR')} ·
    {run.published_at ? `publiée le ${new Date(run.published_at).toLocaleString('fr-FR')}` : 'pas encore publiée'}
  {:else}
    · pas de calcul ce jour-là
  {/if}
</p>

<table>
  <thead><tr><th>Carte</th><th>Score</th><th>Vues hier</th><th>Moyenne</th><th>État</th><th></th></tr></thead>
  <tbody>
    {#each cards as c (c.cardId)}
      <tr>
        <td><a href="/cards/{encodeURIComponent(c.cardId)}">{c.cardId}</a></td>
        <td>×{c.score}</td>
        <td>{c.views}</td>
        <td>{c.average}</td>
        <td>{c.excluded ? `exclue (${REASONS[c.excluded] ?? c.excluded})` : 'en tendance'}</td>
        <td>
          {#if c.excluded === 'admin' || c.excluded === null}
            <button onclick={() => act(() => api.setTrendingExcluded(date, c.cardId, !c.excluded), c.excluded ? 'Carte rétablie.' : 'Carte écartée.')}>
              {c.excluded ? 'Rétablir' : 'Écarter'}
            </button>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<h2>Liste de surveillance</h2>
<form
  class="row"
  onsubmit={(e) => {
    e.preventDefault();
    void act(() => api.addWatchlist(newCard.trim(), newReason.trim()), 'Carte ajoutée à la liste de surveillance.').then(() => {
      newCard = newReason = '';
    });
  }}
>
  <input placeholder="identifiant de carte" bind:value={newCard} />
  <input placeholder="raison (décès, drame…)" bind:value={newReason} />
  <button disabled={!newCard.trim()}>Ajouter</button>
</form>
<ul>
  {#each watchlist as w (w.cardId)}
    <li>
      <strong>{w.cardId}</strong>{w.reason ? ` — ${w.reason}` : ''}
      <button onclick={() => act(() => api.removeWatchlist(w.cardId), 'Carte retirée de la liste.')}>Retirer</button>
    </li>
  {/each}
</ul>

<style>
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
