<script lang="ts">
  import { CATEGORY_NAMES, cardText, type MatchContext } from '@rabbithole/engine';
  import { loc, locale, t } from '../i18n';
  import { session } from '../session.svelte';
  import { viewer } from '../viewer.svelte';
  import ReportDialog from './ReportDialog.svelte';
  import { CATEGORY_STYLE, RARITY_STYLE } from '../game/theme';

  /** Contenu d'une carte (nom, chiffres, règles, ambiance) : fiche plein écran et aperçu au survol. */
  interface Props {
    ctx: MatchContext;
    defId: string;
    /** Puissance actuelle si la carte est en jeu. */
    power?: number | null;
    compact?: boolean;
  }
  let { ctx, defId, power = null, compact = false }: Props = $props();

  const def = $derived(ctx.cards[defId]);
  const lines = $derived(def ? cardText(ctx, def, locale) : []);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const color = $derived(def ? hex(CATEGORY_STYLE[def.categories[0] ?? 'internet'].color) : '#888');
  const frame = $derived(def ? RARITY_STYLE[def.rarity] : null);
  const masked = $derived(viewer.masked.has(defId));
  const credit = $derived(masked ? undefined : viewer.credits.get(defId));
  let reporting = $state(false);
</script>

{#if def && frame}
  <div class="info" class:compact style:--cat={color} style:--frame={hex(frame.color)}>
    <div class="top">
      {#if def.type !== 'leader'}<span class="cost" title={t('cost')}>{def.cost}</span>{/if}
      <div class="titles">
        <h2>{loc(def.name)}</h2>
        <p class="meta">{def.categories.map((c) => `${CATEGORY_STYLE[c].glyph} ${CATEGORY_NAMES[c][locale]}`).join(' · ')}</p>
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
          <li>{#if line.keyword}<strong>{line.keyword}</strong> — {/if}{line.text}</li>
        {/each}
      </ul>
    {/if}
    {#if def.flavor && !compact}<p class="flavor">« {loc(def.flavor)} »</p>{/if}
    {#if masked}<p class="masked">{t('masked_notice')} {#if !compact && session.user}<a href="/settings">{t('masked_settings')}</a>{/if}</p>{/if}
    {#if credit && !compact}
      <figure class="photo">
        <img src={credit.imageUrl} alt="" loading="lazy" />
        <figcaption>
          <a href={credit.filePage} target="_blank" rel="noreferrer">{t('photo_credit', { author: credit.author, license: credit.license, modified: credit.modified ? t('photo_modified') : '' })}</a>
        </figcaption>
      </figure>
    {/if}
    {#if !compact}
      <p class="links">
        {#if session.user}<button class="link" onclick={() => (reporting = true)} data-testid="report-card">{t('report')}</button> · {/if}
        <a href="/takedown?card={encodeURIComponent(defId)}">{t('takedown')}</a>
      </p>
    {/if}
  </div>
  {#if reporting}<ReportDialog target={{ type: 'card', cardId: defId }} onclose={() => (reporting = false)} />{/if}
{/if}

<style>
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
  .compact h2 {
    font-size: 20px;
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
  .compact .cost,
  .compact .power {
    width: 38px;
    height: 38px;
    font-size: 19px;
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
  .compact li {
    padding: 8px 10px;
    font-size: 15px;
  }
  .flavor {
    color: var(--muted);
    font-style: italic;
    margin: 16px 0 0;
  }
  .masked {
    margin: 14px 0 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.05);
    color: var(--muted);
    font-size: 14px;
  }
  .masked a,
  .links a,
  .links .link {
    color: var(--accent);
  }
  .photo {
    margin: 16px 0 0;
    display: grid;
    gap: 6px;
  }
  .photo img {
    width: 100%;
    max-height: 220px;
    object-fit: cover;
    border-radius: 12px;
  }
  .photo figcaption a {
    color: var(--muted);
    font-size: 12px;
  }
  .links {
    margin: 14px 0 0;
    font-size: 13px;
    color: var(--muted);
  }
  .link {
    background: none;
    padding: 0;
    text-decoration: underline;
    font-size: 13px;
  }
</style>
