<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorMessage, type CountryRuleRow } from '$lib/api';

  /** Règles par pays (section 9) : contenu adulte, contenu politique, cartes bloquées. Sans règle : tout est autorisé. */
  let rules = $state.raw<CountryRuleRow[]>([]);
  let country = $state('');
  let allowAdult = $state(true);
  let allowPolitical = $state(true);
  let blocked = $state('');
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);

  async function load(): Promise<void> {
    rules = (await api.countryRules()).rules;
  }
  onMount(() => void load().catch((err: unknown) => (error = errorMessage(err))));

  function edit(r: CountryRuleRow): void {
    country = r.country;
    allowAdult = r.allow_adult;
    allowPolitical = r.allow_political;
    blocked = r.blocked_card_ids.join(', ');
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = message = null;
    try {
      const code = country.trim().toUpperCase();
      await api.setCountryRule(code, {
        allowAdult,
        allowPolitical,
        blockedCardIds: blocked
          .split(/[\s,]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      });
      message = `Règles de ${code} enregistrées.`;
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<h1>Règles par pays</h1>
<p class="muted">
  Dans un pays qui interdit un type de contenu, les cartes concernées sont absentes des boosters, refusées en deck, cachées dans la collection,
  et affichées masquées chez un adversaire d'un autre pays. À valider juridiquement pays par pays.
</p>
{#if error}<p class="error">{error}</p>{/if}
{#if message}<p class="notice">{message}</p>{/if}

<table>
  <thead><tr><th>Pays</th><th>Contenu adulte</th><th>Contenu politique</th><th>Cartes bloquées</th><th></th></tr></thead>
  <tbody>
    {#each rules as r (r.country)}
      <tr>
        <td><strong>{r.country}</strong></td>
        <td><span class="tag {r.allow_adult ? 'ok' : 'bad'}">{r.allow_adult ? 'autorisé' : 'interdit'}</span></td>
        <td><span class="tag {r.allow_political ? 'ok' : 'bad'}">{r.allow_political ? 'autorisé' : 'interdit'}</span></td>
        <td>{r.blocked_card_ids.join(', ') || '—'}</td>
        <td><button onclick={() => edit(r)}>Modifier</button></td>
      </tr>
    {:else}
      <tr><td colspan="5" class="muted">Aucune règle : tout est autorisé partout.</td></tr>
    {/each}
  </tbody>
</table>

<h2>Ajouter ou modifier</h2>
<form class="panel grid" onsubmit={save}>
  <label>Pays (ISO) <input maxlength="2" required pattern="[A-Za-z]{'{2}'}" bind:value={country} placeholder="TR" /></label>
  <label class="check"><input type="checkbox" bind:checked={allowAdult} /> Contenu adulte autorisé</label>
  <label class="check"><input type="checkbox" bind:checked={allowPolitical} /> Contenu politique autorisé</label>
  <label class="wide">Cartes bloquées (identifiants séparés par des virgules) <textarea rows="2" bind:value={blocked}></textarea></label>
  <button class="primary" type="submit">Enregistrer</button>
</form>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    align-items: end;
  }
  label {
    display: grid;
    gap: 4px;
    color: var(--muted);
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text);
  }
  .wide {
    grid-column: 1 / -1;
  }
</style>
