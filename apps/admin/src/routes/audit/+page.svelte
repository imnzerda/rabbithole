<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorMessage, type AuditEntry } from '$lib/api';

  let entries = $state.raw<AuditEntry[]>([]);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      entries = (await api.audit(300)).entries;
    } catch (err) {
      error = errorMessage(err);
    }
  });

  const when = (d: string) => new Date(d).toLocaleString('fr-FR');
</script>

<h1>Journal d'audit</h1>
<p class="muted">Toutes les actions d'administration, horodatées (section 12).</p>
{#if error}<p class="error">{error}</p>{/if}
<table>
  <thead><tr><th>Date</th><th>Admin</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead>
  <tbody>
    {#each entries as e (e.id)}
      <tr>
        <td class="muted">{when(e.created_at)}</td>
        <td>{e.admin ?? '—'}</td>
        <td><code>{e.action}</code></td>
        <td>{e.target ?? ''}</td>
        <td class="muted"><code>{JSON.stringify(e.payload)}</code></td>
      </tr>
    {/each}
  </tbody>
</table>
