<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { PROTOTYPE_DECKS, prototypeContext } from '@rabbithole/content';
  import { LocalMatch } from '$lib/match/local-match';
  import Game from '$lib/ui/Game.svelte';

  /** Entraînement hors ligne contre l'IA (aucun enjeu, rien n'est enregistré). */
  const ctx = prototypeContext();
  const deckId = page.url.searchParams.get('deck');
  const timers = page.url.searchParams.get('timer') !== '0';
  const myDeck = PROTOTYPE_DECKS.find((d) => d.id === deckId) ?? PROTOTYPE_DECKS[0]!;

  function newClient(): LocalMatch {
    const others = PROTOTYPE_DECKS.filter((d) => d.id !== myDeck.id);
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
