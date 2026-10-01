<script lang="ts">
  import { cardText, type GameAction, type MatchContext, type PlayerView, type VisibleCard } from '@rabbithole/engine';
  import { loc, locale, t } from '../i18n';

  interface Props {
    ctx: MatchContext;
    view: PlayerView;
    onact: (action: GameAction) => void;
  }
  let { ctx, view, onact }: Props = $props();

  const legal = $derived(view.legal);
  const name = (defId: string) => loc(ctx.cards[defId]?.name);

  /** Toutes les cartes visibles du plateau, par uid. */
  const board = $derived.by(() => {
    const map = new Map<string, VisibleCard>();
    for (const side of [view.me, view.opponent]) {
      map.set(side.leader.uid, side.leader);
      for (const c of side.characters) map.set(c.uid, c);
    }
    for (const c of view.me.hand) map.set(c.uid, c);
    return map;
  });

  const battle = $derived(view.battle);
  const attacker = $derived(battle ? board.get(battle.attacker) : undefined);
  const target = $derived(battle ? board.get(battle.target) : undefined);
  const targetName = $derived(target ? (target.uid === view.me.leader.uid ? t('your_leader') : name(target.defId)) : '');

  // --- Contres
  let picked = $state<string[]>([]);
  const counterValue = (uid: string) => legal?.counters.find((o) => o.uid === uid)?.value ?? 0;
  const pickedCost = $derived(picked.reduce((sum, uid) => sum + (legal?.counters.find((o) => o.uid === uid)?.cost ?? 0), 0));
  const defense = $derived((battle?.defenderPower ?? 0) + picked.reduce((sum, uid) => sum + counterValue(uid), 0));
  const hit = $derived((battle?.attackerPower ?? 0) >= defense);

  function toggle(uid: string, cost: number): void {
    if (picked.includes(uid)) picked = picked.filter((u) => u !== uid);
    else if (pickedCost + cost <= view.me.buzzActive) picked = [...picked, uid];
  }

  function send(action: GameAction): void {
    picked = [];
    onact(action);
  }

  const triggerLines = $derived.by(() => {
    if (!view.revealedTrigger) return [];
    const def = ctx.cards[view.revealedTrigger.defId];
    return def ? cardText(ctx, def, locale).filter((l) => l.text.includes(t('trigger'))) : [];
  });
</script>

{#if legal && legal.kind !== 'main'}
  <section class="panel" data-testid="decision-{legal.kind}" aria-live="polite">
    {#if legal.kind === 'mulligan'}
      <h3>{t('mulligan_title')}</h3>
      <p class="hint">{t('mulligan_hint')}</p>
      <ul class="hand">
        {#each view.me.hand as c (c.uid)}
          <li><span class="cost">{c.cost}</span>{name(c.defId)}</li>
        {/each}
      </ul>
      <div class="actions">
        <button class="btn" onclick={() => send({ type: 'mulligan', redraw: true })}>{t('redraw')}</button>
        <button class="btn btn-primary" data-testid="keep" onclick={() => send({ type: 'mulligan', redraw: false })}>{t('keep_hand')}</button>
      </div>
    {:else if battle && attacker && target}
      <p class="battle">
        {t('attack_on', { attacker: name(attacker.defId), a: battle.attackerPower, target: targetName, d: battle.defenderPower })}
      </p>

      {#if legal.kind === 'block'}
        <h3>{t('block_prompt')}</h3>
        <div class="actions column">
          {#each legal.blockers as uid (uid)}
            {@const b = board.get(uid)}
            {#if b}
              <button class="btn" onclick={() => send({ type: 'block', blocker: uid })}>{t('block_with', { name: name(b.defId), p: b.power })}</button>
            {/if}
          {/each}
          <button class="btn btn-primary" data-testid="no-block" onclick={() => send({ type: 'block', blocker: null })}>{t('no_block')}</button>
        </div>
      {:else if legal.kind === 'counter'}
        <h3>{t('counter_prompt')}</h3>
        <div class="counters">
          {#each legal.counters as o (o.uid)}
            {@const c = board.get(o.uid)}
            {#if c}
              <button class="chip" class:on={picked.includes(o.uid)} onclick={() => toggle(o.uid, o.cost)}>
                <strong>{o.event ? t('counter_event', { n: o.cost }) : `+${o.value}`}</strong>
                {name(c.defId)}
              </button>
            {/if}
          {/each}
        </div>
        <p class="result" class:hit class:safe={!hit}>{t('counter_total', { d: defense, result: hit ? t('result_hit') : t('result_safe') })}</p>
        <div class="actions">
          <button class="btn" data-testid="no-counter" onclick={() => send({ type: 'counter', uids: [] })}>{t('no_counter')}</button>
          <button class="btn btn-primary" disabled={picked.length === 0} onclick={() => send({ type: 'counter', uids: picked })}>
            {t('confirm_counter')}
          </button>
        </div>
      {/if}
    {:else if legal.kind === 'trigger' && view.revealedTrigger}
      <h3>{t('trigger_prompt')}</h3>
      <p class="trigger-card"><strong>{name(view.revealedTrigger.defId)}</strong></p>
      {#each triggerLines as line, i (i)}<p class="hint">{line.text}</p>{/each}
      <div class="actions">
        <button class="btn" data-testid="keep-trigger" onclick={() => send({ type: 'trigger', activate: false })}>{t('keep_trigger')}</button>
        <button class="btn btn-primary" onclick={() => send({ type: 'trigger', activate: true })}>{t('activate_trigger')}</button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .panel {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 8px;
    background: rgb(23 18 37 / 0.96);
    border: 1px solid var(--accent);
    border-radius: 18px;
    padding: 14px 16px;
    box-shadow: 0 -8px 30px rgb(0 0 0 / 0.5);
    z-index: 20;
  }
  /* Écran large : le panneau se range à droite pour laisser la main et le plateau visibles. */
  @media (min-width: 900px) and (min-aspect-ratio: 23/20) {
    .panel {
      left: auto;
      right: 12px;
      top: 12px;
      bottom: auto;
      width: min(380px, 28%);
      max-height: calc(100% - 24px);
      overflow-y: auto;
    }
  }
  h3 {
    margin: 0 0 8px;
    font-size: 16px;
  }
  .battle {
    margin: 0 0 8px;
    color: var(--lose);
    font-weight: 700;
  }
  .hint {
    margin: 0 0 8px;
    color: var(--muted);
    font-size: 14px;
  }
  .hand {
    list-style: none;
    padding: 0;
    margin: 0 0 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hand li {
    background: var(--panel);
    border-radius: 10px;
    padding: 4px 10px;
    font-size: 14px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .cost {
    background: var(--mana);
    color: #06131f;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    display: inline-grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
  }
  .counters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .chip {
    padding: 6px 10px;
    border-radius: 12px;
    background: var(--panel);
    border: 2px solid var(--line);
    font-size: 14px;
    display: flex;
    gap: 6px;
  }
  .chip.on {
    border-color: var(--win);
    background: color-mix(in srgb, var(--win) 18%, var(--panel));
  }
  .result {
    margin: 0 0 8px;
    font-weight: 700;
  }
  .result.hit {
    color: var(--lose);
  }
  .result.safe {
    color: var(--win);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions .btn {
    flex: 1;
  }
  .actions.column {
    flex-direction: column;
  }
  .trigger-card {
    margin: 0 0 4px;
  }
</style>
