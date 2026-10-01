<script lang="ts">
  import { KEYWORD_NAMES, KEYWORDS, keywordText, rulesSummary, type RulesConfig } from '@rabbithole/engine';
  import { locale, t } from '../i18n';
  import InfoSheet from './InfoSheet.svelte';

  interface Props {
    rules: RulesConfig;
    onclose: () => void;
  }
  let { rules, onclose }: Props = $props();
</script>

<InfoSheet title={t('rules_title')} {onclose}>
  <ol class="rules">
    {#each rulesSummary(rules, locale) as line, i (i)}
      <li>{line}</li>
    {/each}
  </ol>
  <h3>{t('keywords_title')}</h3>
  <dl>
    {#each KEYWORDS as k (k)}
      <dt>{KEYWORD_NAMES[k]?.[locale] ?? k}</dt>
      <dd>{keywordText(rules, k, locale)}</dd>
    {/each}
  </dl>
</InfoSheet>

<style>
  .rules {
    margin: 0;
    padding-left: 22px;
    display: grid;
    gap: 8px;
    line-height: 1.4;
  }
  h3 {
    margin: 20px 0 8px;
    font-size: 16px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
  }
  dt {
    font-weight: 700;
    color: var(--accent);
  }
  dd {
    margin: 0;
    line-height: 1.35;
  }
</style>
