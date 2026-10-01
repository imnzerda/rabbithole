<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<main>
  <a class="brand" href="/">RABBIT HOLE</a>
  <section class="card">
    <h1>{title}</h1>
    {@render children()}
  </section>
</main>

<style>
  main {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 18px;
    padding: 24px 16px;
  }
  .brand {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-decoration: none;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .card {
    width: min(420px, 100%);
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 24px;
  }
  h1 {
    margin: 0 0 16px;
    font-size: 24px;
  }
  .card :global(form) {
    display: grid;
    gap: 12px;
  }
  .card :global(label) {
    display: grid;
    gap: 4px;
    font-size: 14px;
    color: var(--muted);
  }
  .card :global(input),
  .card :global(select) {
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .card :global(input:focus),
  .card :global(select:focus) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .card :global(.error) {
    margin: 0;
    color: var(--lose);
    font-weight: 700;
  }
  .card :global(.alt) {
    text-align: center;
    color: var(--muted);
    font-size: 14px;
  }
  .card :global(.alt a) {
    color: var(--accent);
  }
</style>
