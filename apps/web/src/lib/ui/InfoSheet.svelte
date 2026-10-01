<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n';

  interface Props {
    title: string;
    onclose: () => void;
    /** Panneau large sur PC (contenu en colonnes). */
    wide?: boolean;
    children: Snippet;
  }
  let { title, onclose, wide = false, children }: Props = $props();
</script>

<div class="sheet-backdrop" role="presentation" onclick={onclose}>
  <div
    class="sheet"
    class:wide
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.key === 'Escape' && onclose()}
  >
    <header>
      <h2>{title}</h2>
      <button class="x" aria-label={t('close')} onclick={onclose}>✕</button>
    </header>
    {@render children()}
    <button class="btn close" onclick={onclose}>{t('close')}</button>
  </div>
</div>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    flex: 1;
  }
  .x {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--panel);
    border: 1px solid var(--line);
    flex: none;
  }
  .close {
    margin-top: 18px;
    width: 100%;
  }
  .wide {
    width: min(1120px, 100%);
  }
  @media (min-width: 900px) {
    .wide {
      padding: 28px 32px;
    }
    .wide h2 {
      font-size: 28px;
    }
    .wide .close {
      width: auto;
      min-width: 220px;
      display: block;
      margin: 22px auto 0;
    }
  }
</style>
