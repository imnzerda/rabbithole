<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Page de contenu simple (réglages, crédits, demande de retrait) : titre, colonne lisible. */
  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<main>
  <header>
    <h1>{title}</h1>
  </header>
  {@render children()}
</main>

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 40px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  h1 {
    margin: 0;
  }
  main :global(.panel) {
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 16px;
  }
  main :global(.muted) {
    color: var(--muted);
  }
  main :global(form) {
    display: grid;
    gap: 12px;
  }
  main :global(label) {
    display: grid;
    gap: 4px;
    font-size: 14px;
    color: var(--muted);
  }
  main :global(input),
  main :global(select),
  main :global(textarea) {
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  main :global(.error) {
    color: var(--lose);
    font-weight: 700;
  }
  main :global(.notice) {
    color: var(--win);
    font-weight: 700;
  }
</style>
