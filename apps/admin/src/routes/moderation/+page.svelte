<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorMessage, type ReportRow, type TakedownRow } from '$lib/api';

  let takedowns = $state.raw<TakedownRow[]>([]);
  let reports = $state.raw<ReportRow[]>([]);
  let reportStatus = $state<'open' | 'resolved' | 'dismissed'>('open');
  let notes = $state<Record<string, string>>({});
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);

  const RELATIONS: Record<string, string> = { self: 'la personne', representative: 'son représentant', rights_holder: "ayant droit d'une image", other: 'autre' };
  const STATUS: Record<string, string> = { open: 'À traiter', in_progress: 'En cours', done: 'Traitée', rejected: 'Rejetée' };
  const when = (d: string) => new Date(d).toLocaleString('fr-FR');

  async function load(): Promise<void> {
    try {
      takedowns = (await api.takedowns()).takedowns;
      reports = (await api.reports(reportStatus)).reports;
    } catch (err) {
      error = errorMessage(err);
    }
  }
  onMount(load);

  async function takedown(t: TakedownRow, status: TakedownRow['status'], retireCard = false): Promise<void> {
    if (retireCard && !confirm(`Retirer la carte ${t.card_id} du jeu ?`)) return;
    error = message = null;
    try {
      await api.handleTakedown(t.id, status, notes[t.id] ?? '', retireCard);
      message = retireCard ? `Carte ${t.card_id} retirée du jeu.` : `Demande : ${STATUS[status]}.`;
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function resolve(r: ReportRow, status: 'resolved' | 'dismissed'): Promise<void> {
    error = message = null;
    try {
      await api.resolveReport(r.id, status, notes[r.id] ?? '');
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<h1>Modération</h1>
{#if error}<p class="error">{error}</p>{/if}
{#if message}<p class="notice">{message}</p>{/if}

<h2>Demandes de retrait <span class="muted">(à traiter sous 72 h)</span></h2>
<table>
  <thead><tr><th>Reçue</th><th>Carte</th><th>Demandeur</th><th>Motif</th><th>Statut</th><th>Traitement</th></tr></thead>
  <tbody>
    {#each takedowns as t (t.id)}
      <tr class:late={t.overdue && (t.status === 'open' || t.status === 'in_progress')}>
        <td>{when(t.created_at)}<br /><span class="muted">échéance {when(t.due_at)}</span></td>
        <td><a href="/cards/{encodeURIComponent(t.card_id)}">{t.card_name ?? t.card_id}</a><br /><span class="muted">{t.card_status}</span></td>
        <td>{t.requester_name}<br /><a href="mailto:{t.requester_contact}">{t.requester_contact}</a><br /><span class="muted">{RELATIONS[t.relation] ?? t.relation}</span></td>
        <td class="reason">{t.reason}</td>
        <td><span class="tag {t.status === 'done' ? 'ok' : t.status === 'rejected' ? '' : 'warn'}">{STATUS[t.status]}</span>{#if t.resolution}<br /><span class="muted">{t.resolution}</span>{/if}</td>
        <td>
          {#if t.status === 'open' || t.status === 'in_progress'}
            <textarea rows="2" placeholder="Réponse / note" bind:value={notes[t.id]}></textarea>
            <div class="row">
              {#if t.status === 'open'}<button onclick={() => takedown(t, 'in_progress')}>Prendre en charge</button>{/if}
              <button class="danger" onclick={() => takedown(t, 'done', true)}>Retirer la carte</button>
              <button onclick={() => takedown(t, 'done')}>Traitée (sans retrait)</button>
              <button onclick={() => takedown(t, 'rejected')}>Rejeter</button>
            </div>
          {/if}
        </td>
      </tr>
    {:else}
      <tr><td colspan="6" class="muted">Aucune demande.</td></tr>
    {/each}
  </tbody>
</table>

<h2 class="row">
  Signalements
  <select bind:value={reportStatus} onchange={load}>
    <option value="open">Ouverts</option>
    <option value="resolved">Résolus</option>
    <option value="dismissed">Classés</option>
  </select>
</h2>
<table>
  <thead><tr><th>Reçu</th><th>Cible</th><th>Motif</th><th>Par</th><th>Traitement</th></tr></thead>
  <tbody>
    {#each reports as r (r.id)}
      <tr>
        <td>{when(r.created_at)}</td>
        <td>
          {#if r.target_type === 'card'}Carte <a href="/cards/{encodeURIComponent(r.card_id ?? '')}">{r.card_name ?? r.card_id}</a>
          {:else}Joueur <strong>{r.target_user ?? '?'}</strong> <span class="muted">(partie {r.match_id?.slice(0, 8)})</span>{/if}
          {#if r.open_on_target > 1}<br /><span class="tag warn">{r.open_on_target} signalements ouverts</span>{/if}
        </td>
        <td><strong>{r.reason}</strong>{#if r.details}<br /><span class="muted">{r.details}</span>{/if}</td>
        <td>{r.reporter ?? '—'}</td>
        <td>
          {#if r.status === 'open'}
            <textarea rows="2" placeholder="Décision (obligatoire)" bind:value={notes[r.id]}></textarea>
            <div class="row">
              <button onclick={() => resolve(r, 'resolved')} disabled={(notes[r.id] ?? '').trim().length < 3}>Résolu</button>
              <button onclick={() => resolve(r, 'dismissed')} disabled={(notes[r.id] ?? '').trim().length < 3}>Classer</button>
            </div>
          {:else}<span class="muted">{r.resolution}</span>{/if}
        </td>
      </tr>
    {:else}
      <tr><td colspan="5" class="muted">Aucun signalement.</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .late {
    background: rgb(255 92 108 / 0.08);
  }
  .reason {
    max-width: 360px;
    white-space: pre-wrap;
  }
  textarea {
    width: 100%;
    margin-bottom: 6px;
  }
  h2.row {
    gap: 12px;
  }
</style>
