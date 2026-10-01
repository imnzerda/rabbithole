<script lang="ts">
  import type { MatchContext } from '@rabbithole/engine';
  import { loc, t } from '../i18n';
  import { CATEGORY_STYLE, RARITY_STYLE } from '../game/theme';
  import CardInfo from './CardInfo.svelte';

  interface Props {
    ctx: MatchContext;
    defId: string;
    /** Puissance actuelle si la carte est en jeu. */
    power?: number | null;
    onclose: () => void;
  }
  let { ctx, defId, power = null, onclose }: Props = $props();

  const def = $derived(ctx.cards[defId]);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const color = $derived(def ? hex(CATEGORY_STYLE[def.categories[0] ?? 'internet'].color) : '#888');
  const frame = $derived(def ? RARITY_STYLE[def.rarity] : null);
</script>

{#if def && frame}
  <div class="sheet-backdrop" role="presentation" onclick={onclose}>
    <div
      class="sheet card"
      role="dialog"
      aria-modal="true"
      aria-label={loc(def.name)}
      tabindex="-1"
      style:--cat={color}
      style:--frame={hex(frame.color)}
      style:border-radius="{frame.radius + 8}px"
      style:border-width="{frame.lines + 1}px"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && onclose()}
    >
      <CardInfo {ctx} {defId} {power} />
      <button class="btn close" onclick={onclose}>{t('close')}</button>
    </div>
  </div>
{/if}

<style>
  .card {
    border: 2px solid var(--frame);
    background: linear-gradient(160deg, color-mix(in srgb, var(--cat) 28%, var(--bg-2)), var(--bg-2) 60%);
  }
  .close {
    margin-top: 18px;
    width: 100%;
  }
</style>
