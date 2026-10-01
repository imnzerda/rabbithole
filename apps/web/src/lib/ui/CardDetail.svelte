<script lang="ts">
  import { CATEGORY_NAMES, cardText, type MatchContext } from '@rabbithole/engine';
  import { loc, locale, t } from '../i18n';
  import { CATEGORY_STYLE, RARITY_STYLE } from '../game/theme';

  interface Props {
    ctx: MatchContext;
    defId: string;
    /** Puissance actuelle si la carte est en jeu. */
    power?: number | null;
    onclose: () => void;
  }
  let { ctx, defId, power = null, onclose }: Props = $props();

  const def = $derived(ctx.cards[defId]);
  const lines = $derived(def ? cardText(ctx, def, locale) : []);
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
      <div class="top">
        {#if def.type !== 'leader'}<span class="cost" title={t('cost')}>{def.cost}</span>{/if}
        <div class="titles">
          <h2>{loc(def.name)}</h2>
          <p class="meta">
            {def.categories.map((c) => `${CATEGORY_STYLE[c].glyph} ${CATEGORY_NAMES[c][locale]}`).join(' · ')}
          </p>
        </div>
        {#if def.type !== 'event'}<span class="power" title={t('power')}>{power ?? def.power}</span>{/if}
      </div>
      <p class="rarity">
        {def.type === 'leader' ? t('leader') : def.type === 'event' ? t('event') : ''}
        {def.type !== 'character' ? ' · ' : ''}{t('rarity')} : {t(`rarity_${def.rarity}`)}
        {#if def.type === 'leader'} · ❤ {def.life} {t('life')}{/if}
        {#if (def.counter ?? 0) > 0} · {t('counter_value')} +{def.counter}{/if}
      </p>

      {#if lines.length}
        <ul>
          {#each lines as line, i (i)}
            <li>
              {#if line.keyword}<strong>{line.keyword}</strong> — {/if}{line.text}
            </li>
          {/each}
        </ul>
      {/if}

      {#if def.flavor}<p class="flavor">« {loc(def.flavor)} »</p>{/if}

      <button class="btn close" onclick={onclose}>{t('close')}</button>
    </div>
  </div>
{/if}

<style>
  .card {
    border: 2px solid var(--frame);
    background: linear-gradient(160deg, color-mix(in srgb, var(--cat) 28%, var(--bg-2)), var(--bg-2) 60%);
  }
  .top {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 24px;
    line-height: 1.1;
  }
  .meta {
    margin: 4px 0 0;
    color: var(--cat);
    font-weight: 700;
    font-size: 14px;
  }
  .cost,
  .power {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 700;
  }
  .cost {
    background: var(--mana);
    color: #06131f;
  }
  .power {
    background: #ffc94a;
    color: #1b1206;
  }
  .rarity {
    margin: 12px 0 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--frame);
    font-weight: 700;
  }
  ul {
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }
  li {
    background: rgb(255 255 255 / 0.05);
    border-radius: 10px;
    padding: 10px 12px;
    line-height: 1.35;
  }
  .flavor {
    color: var(--muted);
    font-style: italic;
    margin: 16px 0 0;
  }
  .close {
    margin-top: 18px;
    width: 100%;
  }
</style>
