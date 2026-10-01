<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n';

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
  }
  let { title, onclose, children }: Props = $props();
</script>

<div class="sheet-backdrop" role="presentation" onclick={onclose}>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.key === 'Escape' && onclose()}
  >
    <h2>{title}</h2>
    {@render children()}
    <button class="btn close" onclick={onclose}>{t('close')}</button>
  </div>
</div>

<style>
  h2 {
    margin: 0 0 12px;
    font-size: 22px;
  }
  .close {
    margin-top: 18px;
    width: 100%;
  }
</style>
