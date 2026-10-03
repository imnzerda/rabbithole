<script lang="ts">
  import { KEYWORD_NAMES, type MatchContext } from '@rabbithole/engine';
  import { loc, locale, t } from '../i18n';
  import { CATEGORY_STYLE, RARITY_STYLE } from '../game/theme';

  /** Carte en HTML (collection, boosters, éditeur de decks) : même design typographique que le plateau. */
  interface Props {
    ctx: MatchContext;
    defId: string;
    /** Exemplaires possédés (badge « ×n ») ; 0 = carte grisée. `undefined` = pas de badge. */
    count?: number;
    /** Badge « Nouveau ! » (ouverture de booster). */
    fresh?: boolean;
    selected?: boolean;
    /** Variante cosmétique affichée (holo, gold, glitch, negative, vhs, pixel) : même carte, autre apparence. */
    variant?: string | null;
    onclick?: () => void;
  }
  let { ctx, defId, count, fresh = false, selected = false, variant = null, onclick }: Props = $props();

  const def = $derived(ctx.cards[defId]);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const cat = $derived(CATEGORY_STYLE[def?.categories[0] ?? 'internet']);
  const cat2 = $derived(def?.categories[1] ? CATEGORY_STYLE[def.categories[1]] : null);
  const frame = $derived(def ? RARITY_STYLE[def.rarity] : null);
  // Le mot le plus long doit tenir sur une ligne : la police s'adapte au lieu de couper le mot.
  const nameSize = $derived.by(() => {
    const longest = Math.max(...loc(def?.name).split(/\s+/).map((w) => w.length), 1);
    return Math.min(13, 88 / (longest * 0.6));
  });
</script>

{#if def && frame}
  <button
    type="button"
    class="card variant-{variant ?? 'none'}"
    class:missing={count === 0}
    class:selected
    style:--cat={hex(cat.color)}
    style:--cat2={hex((cat2 ?? cat).color)}
    style:--frame={hex(frame.color)}
    style:--radius="{frame.radius}px"
    style:--lines={frame.lines}
    aria-label={loc(def.name)}
    title={loc(def.name)}
    {onclick}
  >
    {#if variant}<span class="fx" aria-hidden="true"></span>{/if}
    <span class="band"></span>
    <span class="glyph" aria-hidden="true">{cat.glyph}</span>
    {#if def.type !== 'leader'}<span class="cost">{def.cost}</span>{/if}
    {#if def.type === 'leader'}<span class="type leader">{t('leader')} · ❤ {def.life}</span>{/if}
    {#if def.type === 'event'}<span class="type">{t('event')}</span>{/if}
    <span class="name" style:font-size="{nameSize}cqi">{loc(def.name)}</span>
    {#if def.keywords.length}<span class="kw">{def.keywords.map((k) => KEYWORD_NAMES[k][locale]).join(' · ')}</span>{/if}
    {#if (def.counter ?? 0) > 0}<span class="counter">+{def.counter}</span>{/if}
    {#if def.type !== 'event'}<span class="power">{def.power}</span>{/if}
    {#if count !== undefined && count > 0}<span class="count">×{count}</span>{/if}
    {#if fresh}<span class="fresh">{t('new_card')}</span>{/if}
  </button>
{/if}

<style>
  .card {
    position: relative;
    width: 100%;
    aspect-ratio: 108 / 148;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--cat) 26%, #0d0a14);
    border: calc(var(--lines) * 1.5px + 1px) double var(--frame);
    overflow: hidden;
    padding: 0;
    color: var(--text);
    text-align: center;
    container-type: inline-size;
    transition: transform 0.12s;
  }
  .card:hover {
    transform: translateY(-2px);
  }
  .card.selected {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .missing {
    filter: grayscale(0.85) brightness(0.55);
  }
  .band {
    position: absolute;
    top: 5%;
    left: 6%;
    right: 6%;
    height: 3.5%;
    background: linear-gradient(90deg, var(--cat) 50%, var(--cat2) 50%);
  }
  .glyph {
    position: absolute;
    inset: 30% 0 auto;
    font-size: 48cqi;
    line-height: 1;
    color: var(--cat);
    opacity: 0.16;
    font-weight: 700;
  }
  .cost,
  .power {
    position: absolute;
    width: 26cqi;
    height: 26cqi;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 15cqi;
  }
  .cost {
    top: 4%;
    left: 4%;
    background: var(--mana);
    color: #06131f;
  }
  .power {
    bottom: 3%;
    right: 3%;
    background: #ffc94a;
    color: #1b1206;
  }
  .type {
    position: absolute;
    bottom: 4%;
    left: 6%;
    right: 30%;
    font-size: 8.5cqi;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .type.leader {
    color: #ffc94a;
  }
  .name {
    position: absolute;
    top: 26%;
    left: 6%;
    right: 6%;
    font-size: 13cqi;
    font-weight: 700;
    line-height: 1.15;
    overflow-wrap: break-word;
  }
  .kw {
    position: absolute;
    top: 60%;
    left: 6%;
    right: 6%;
    font-size: 9.5cqi;
    font-weight: 700;
    color: var(--cat);
  }
  .counter {
    position: absolute;
    left: 3%;
    bottom: 3%;
    padding: 1px 5px;
    border-radius: 7px;
    border: 2px solid var(--win);
    color: var(--win);
    background: #2a1f44;
    font-weight: 700;
    font-size: 11cqi;
  }
  .count {
    position: absolute;
    top: 4%;
    right: 4%;
    background: rgb(0 0 0 / 0.75);
    border-radius: 8px;
    padding: 1px 6px;
    font-weight: 700;
    font-size: 11cqi;
  }
  /* Variantes cosmétiques (section 6.6). */
  .fx {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }
  .variant-holo .fx {
    background: linear-gradient(115deg, #ff4fd8, #4fb8ff, #6dff9e, #ffe34f, #ff4fd8);
    background-size: 300% 300%;
    mix-blend-mode: color-dodge;
    opacity: 0.45;
    animation: holo 4s linear infinite;
  }
  @keyframes holo {
    to {
      background-position: 300% 0;
    }
  }
  .variant-gold {
    border-color: #ffc94a;
    background: color-mix(in srgb, #ffc94a 30%, #1b1206);
  }
  .variant-gold .name {
    color: #ffe39a;
  }
  .variant-gold .fx {
    background: linear-gradient(120deg, transparent 35%, rgb(255 240 190 / 0.55) 50%, transparent 65%);
    background-size: 250% 100%;
    animation: shine 3s ease-in-out infinite;
  }
  @keyframes shine {
    from {
      background-position: 150% 0;
    }
    to {
      background-position: -50% 0;
    }
  }
  .variant-glitch .name {
    text-shadow:
      0.12em 0 #ff2b6d,
      -0.12em 0 #2be0ff;
  }
  .variant-glitch .fx {
    background: repeating-linear-gradient(0deg, transparent 0 6%, rgb(43 224 255 / 0.18) 6% 7%, transparent 7% 13%, rgb(255 43 109 / 0.18) 13% 14%);
    animation: glitch 1.6s steps(2) infinite;
  }
  @keyframes glitch {
    0%,
    80% {
      transform: none;
    }
    85% {
      transform: translateX(3%);
    }
    90% {
      transform: translateX(-3%) translateY(2%);
    }
  }
  .variant-negative {
    filter: invert(1) hue-rotate(180deg);
  }
  .variant-vhs {
    filter: saturate(0.6) contrast(1.15) sepia(0.25);
  }
  .variant-vhs .fx {
    background:
      repeating-linear-gradient(0deg, rgb(0 0 0 / 0.25) 0 1px, transparent 1px 3px),
      linear-gradient(transparent 45%, rgb(255 255 255 / 0.18) 50%, transparent 55%);
    background-size:
      100% 100%,
      100% 300%;
    animation: vhs 3.5s linear infinite;
  }
  @keyframes vhs {
    from {
      background-position:
        0 0,
        0 -100%;
    }
    to {
      background-position:
        0 0,
        0 200%;
    }
  }
  .variant-pixel {
    font-family: 'Courier New', monospace;
    border-style: solid;
    border-radius: 0;
  }
  .variant-pixel .fx {
    background:
      linear-gradient(90deg, rgb(255 255 255 / 0.07) 50%, transparent 50%) 0 0 / 6px 6px,
      linear-gradient(rgb(255 255 255 / 0.07) 50%, transparent 50%) 0 0 / 6px 6px;
  }
  .fresh {
    position: absolute;
    top: 64%;
    left: -2%;
    right: -2%;
    transform: rotate(-12deg);
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: 10cqi;
    padding: 2px 0;
    text-transform: uppercase;
  }
</style>
