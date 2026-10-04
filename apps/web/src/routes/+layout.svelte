<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import AppShell from '$lib/ui/shell/AppShell.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<AppShell>{@render children()}</AppShell>
