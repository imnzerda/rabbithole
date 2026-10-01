<script lang="ts">
  import { KEYWORD_NAMES, KEYWORDS, keywordText, rulesSummary, type RulesConfig } from '@rabbithole/engine';
  import { locale, t } from '../i18n';
  import InfoSheet from './InfoSheet.svelte';

  interface Props {
    rules: RulesConfig;
    onclose: () => void;
  }
  let { rules, onclose }: Props = $props();

  /** Une icône par étape de `rulesSummary` (même ordre). */
  const ICONS = ['🎯', '🔄', '⚡', '⚔️', '🛡️', '❤️', '🔥'];
  const steps = $derived(rulesSummary(rules, locale));
</script>

<InfoSheet title={t('rules_title')} {onclose} wide>
  <div class="layout">
    <section>
      <ol class="steps">
        {#each steps as line, i (i)}
          <li>
            <span class="icon" aria-hidden="true">{ICONS[i] ?? '•'}</span>
            <p><span class="num">{i + 1}.</span> {line}</p>
          </li>
        {/each}
      </ol>
    </section>
    <section>
      <h3>{t('keywords_title')}</h3>
      <dl class="keywords">
        {#each KEYWORDS as k (k)}
          <div class="kw">
            <dt>{KEYWORD_NAMES[k][locale]}</dt>
            <dd>{keywordText(rules, k, locale)}</dd>
          </div>
        {/each}
      </dl>
    </section>
  </div>
</InfoSheet>

<style>
  .layout {
    display: grid;
    gap: 20px;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 32px 1fr;
    column-gap: 10px;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 14px;
  }
  .icon {
    font-size: 24px;
    line-height: 1.2;
    text-align: center;
  }
  .num {
    font-weight: 700;
    color: var(--accent);
  }
  .steps p {
    margin: 0;
    line-height: 1.45;
  }
  h3 {
    margin: 0 0 10px;
    font-size: 15px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .keywords {
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .kw {
    background: rgb(255 255 255 / 0.04);
    border-left: 3px solid var(--accent);
    border-radius: 10px;
    padding: 10px 12px;
  }
  dt {
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 2px;
  }
  dd {
    margin: 0;
    line-height: 1.4;
    color: var(--text);
  }

  /* PC : règles à gauche, mots-clés en grille à droite, texte plus grand. */
  @media (min-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
      gap: 28px;
      align-items: start;
    }
    .steps p,
    dd {
      font-size: 16px;
    }
    .icon {
      font-size: 26px;
    }
    .keywords {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    h3 {
      margin-top: 4px;
    }
  }
</style>
