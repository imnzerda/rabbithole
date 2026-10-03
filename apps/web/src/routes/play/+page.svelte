<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { LocalMatch } from '$lib/match/local-match';
  import Game from '$lib/ui/Game.svelte';

  /** Entraînement hors ligne contre l'IA (aucun enjeu, rien n'est enregistré). */
  let { data } = $props();
  // Decks d'entraînement lus une fois (série publiée, sinon prototype).
  const { ctx, decks } = untrack(() => data.practice);
  const deckId = page.url.searchParams.get('deck');
  const timers = page.url.searchParams.get('timer') !== '0';
  const myDeck = decks.find((d) => d.id === deckId) ?? decks[0]!;

  function newClient(): LocalMatch {
    const others = decks.filter((d) => d.id !== myDeck.id);
    const pick = new Uint32Array(1);
    crypto.getRandomValues(pick);
    const aiDeck = others[pick[0]! % others.length] ?? myDeck;
    return new LocalMatch(ctx, myDeck, aiDeck, timers);
  }

  let client = $state.raw(newClient());
</script>

<div class="screen">
  {#key client}
    <Game {client} onexit={() => goto('/')} onagain={() => (client = newClient())} />
  {/key}
</div>

<style>
  .screen {
    height: 100dvh;
  }
</style>
