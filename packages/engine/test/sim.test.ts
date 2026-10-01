import { describe, expect, it } from 'vitest';
import {
  applyAction,
  cardText,
  createMatch,
  effectText,
  eventsFor,
  HIDDEN_UID,
  KEYWORDS,
  keywordText,
  Rng,
  rulesSummary,
  validateCardDef,
  validateCatalog,
  type CardDef,
  type MatchState,
} from '../src/index.js';
import { card, event, POOL } from './fixtures.js';
import { makeContext, playOut, type Brain } from './helpers.js';

const ctx = makeContext(POOL);
const collectible = POOL.filter((c) => c.id !== 'p_token').map((c) => c.id);

function decksFor(seed: string) {
  const rng = Rng.fromSeed(`deck-${seed}`);
  const deck = () => rng.shuffle([...collectible]).slice(0, 10).flatMap((id) => [id, id]);
  return [
    { leader: 'leader_a', deck: deck() },
    { leader: 'leader_b', deck: deck() },
  ] as [{ leader: string; deck: string[] }, { leader: string; deck: string[] }];
}

function game(seed: string, brains: [Brain, Brain], mulligan = true) {
  return playOut(ctx, { seed, decks: decksFor(seed), mulligan }, brains, `bot-${seed}`);
}

function checkInvariants(s: MatchState): void {
  const seen = new Set<string>();
  s.players.forEach((p, i) => {
    const lists: [string[], string][] = [
      [p.deck, 'deck'],
      [p.hand, 'hand'],
      [p.life, 'life'],
      [p.characters, 'field'],
      [p.trash, 'trash'],
    ];
    for (const [list, zone] of lists) {
      for (const uid of list) {
        expect(seen.has(uid), `${uid} en double`).toBe(false);
        seen.add(uid);
        expect(s.cards[uid]?.zone, `${uid} zone`).toBe(zone);
        if (zone === 'field') expect(s.cards[uid]?.controller).toBe(i);
      }
    }
    seen.add(p.leader);
    expect(p.characters.length).toBeLessThanOrEqual(ctx.rules.maxCharacters);
    const attached = [p.leader, ...p.characters].reduce((sum, uid) => sum + (s.cards[uid]?.buzz ?? 0), 0);
    expect(p.buzzActive).toBeGreaterThanOrEqual(0);
    expect(p.buzzDeck + p.buzzActive + p.buzzRested + attached).toBe(ctx.rules.buzzTotal);
  });
  expect(seen.size).toBe(Object.keys(s.cards).length);
  expect(s.stake).toBeLessThanOrEqual(ctx.rules.hype.maxStake);
  if (s.phase === 'block' || s.phase === 'counter') expect(s.battle).not.toBeNull();
  if (s.phase === 'main') expect(s.battle).toBeNull();
}

describe('déterminisme', () => {
  it('même seed + mêmes actions = même partie', () => {
    const a = game('det-1', ['ai', 'random']);
    const b = game('det-1', ['ai', 'random']);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
  });

  it('replay : seed + decks + actions reproduisent la partie', () => {
    const original = game('replay', ['ai', 'ai']);
    const decks = decksFor('replay');
    let { state } = createMatch(ctx, {
      seed: 'replay',
      players: [
        { id: 'A', ...decks[0] },
        { id: 'B', ...decks[1] },
      ],
    });
    for (const { player, action } of original.actions) state = applyAction(ctx, state, player, action).state;
    expect(JSON.stringify(state)).toBe(JSON.stringify(original.state));
  });
});

describe('robustesse (300 parties)', { timeout: 120_000 }, () => {
  it('aucune erreur, invariants à chaque étape, toutes les mécaniques exercées', () => {
    const keywords = new Set<string>();
    const events = new Set<string>();
    const reasons = new Set<string>();
    const pairs: [Brain, Brain][] = [
      ['random', 'random'],
      ['ai', 'random'],
      ['ai', 'ai'],
    ];
    for (let i = 0; i < 300; i++) {
      const { state, states, log } = game(`fuzz-${i}`, pairs[i % 3]!);
      states.forEach(checkInvariants);
      expect(state.phase, `partie ${i} non terminée`).toBe('ended');
      reasons.add(state.result!.reason);
      for (const e of log) {
        events.add(e.type);
        if (e.type === 'keyword_triggered') keywords.add(e.keyword);
      }
    }
    expect([...keywords].sort()).toEqual(KEYWORDS.filter((k) => k !== 'tendance' && k !== 'elan' && k !== 'bloqueur').sort());
    for (const t of ['blocked', 'counter_played', 'trigger_resolved', 'card_ko', 'card_bounced', 'card_stolen', 'effects_cancelled', 'buzz_attached', 'stake_changed']) {
      expect(events, t).toContain(t);
    }
    expect(reasons).toContain('life');
  });
});

describe('IA', { timeout: 120_000 }, () => {
  it('bat largement un joueur aléatoire', () => {
    let wins = 0;
    const n = 120;
    for (let i = 0; i < n; i++) {
      const brains: [Brain, Brain] = i % 2 ? ['ai', 'random'] : ['random', 'ai'];
      const { state } = game(`vs-${i}`, brains);
      const aiSeat = i % 2 ? 0 : 1;
      if (state.result?.winner === aiSeat) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.85);
  });

  it('une partie IA contre IA se termine par KO, en un nombre de tours raisonnable', () => {
    const turns: number[] = [];
    for (let i = 0; i < 40; i++) {
      const { state } = game(`ai-${i}`, ['ai', 'ai']);
      expect(state.result?.reason).not.toBe('turn_limit');
      turns.push(state.turn);
    }
    const avg = turns.reduce((a, b) => a + b, 0) / turns.length;
    expect(avg).toBeGreaterThan(6);
    expect(avg).toBeLessThan(24);
  });
});

describe('textes', () => {
  it('chaque mot-clé et chaque carte du pool ont un texte lisible', () => {
    for (const k of KEYWORDS) for (const l of ['fr', 'en'] as const) expect(keywordText(ctx.rules, k, l).length).toBeGreaterThan(10);
    for (const def of POOL) {
      for (const l of ['fr', 'en'] as const) {
        for (const line of cardText(ctx, def, l)) expect(line.text).not.toMatch(/undefined|\[object/);
      }
    }
    expect(rulesSummary(ctx.rules)).toHaveLength(7);
  });

  it('exemples de rendu', () => {
    expect(effectText({ trigger: 'on_play', action: { type: 'ko', target: 'strongest_enemy', filter: { maxCost: 4 } } })).toBe(
      '[Jouée] Met KO le Personnage adverse le plus fort (coût 4 max).',
    );
    expect(
      effectText({ trigger: 'continuous', condition: { type: 'my_turn' }, action: { type: 'add_power', target: 'allies', amount: 1 } }),
    ).toBe('[Continu] [Ton tour] +1 à tes autres Personnages.');
    expect(
      effectText({ trigger: 'activate_main', buzzCost: 1, action: { type: 'draw', amount: 1 } }, 'en'),
    ).toBe('[Activate: Main] [Once Per Turn] Spend 1 Buzz: Draw 1 card.');
    expect(keywordText(ctx.rules, 'viral')).toBe('Quand elle touche le Leader adverse, il perd 2 Vies.');
  });
});

describe('validation des cartes', () => {
  it('le pool de test est valide', () => {
    expect(validateCatalog(ctx)).toEqual({});
  });

  it('détecte les erreurs', () => {
    const bad: CardDef = card('bad', {
      cost: 11,
      power: -1,
      counter: 5,
      life: 4,
      keywords: ['tendance'],
      effects: [
        { trigger: 'continuous', action: { type: 'ko', target: 'self' } },
        { trigger: 'counter', action: { type: 'draw', amount: 1 } },
        { trigger: 'on_play', buzzCost: 1, action: { type: 'draw', amount: 1 } },
      ],
    });
    const errors = validateCardDef(bad).join('\n');
    for (const f of ['cost', 'power', 'counter', 'life est réservé', 'automatiquement', 'continu ne peut être', 'réservé aux Événements', 'buzzCost']) {
      expect(errors).toContain(f);
    }
    expect(validateCardDef(event('e', { effects: [] })).join()).toContain('effet main ou counter');
    expect(validateCardDef(card('l', { type: 'leader', life: undefined })).join()).toContain('life invalide');
  });
});

describe('événements filtrés par joueur', () => {
  it("ne révèlent jamais les cartes piochées ou récupérées en main par l'adversaire", () => {
    const { log } = game('filtre', ['ai', 'ai']);
    for (const viewer of [0, 1] as const) {
      const opponent = viewer === 0 ? 1 : 0;
      const filtered = eventsFor(log, viewer);
      expect(filtered).toHaveLength(log.length);
      for (const e of filtered) {
        if (e.type === 'card_drawn' && e.player === opponent) expect(e.uid).toBe(HIDDEN_UID);
        if (e.type === 'life_lost' && e.player === opponent && e.to === 'hand') expect(e.uid).toBe(HIDDEN_UID);
        if (e.type === 'card_created' && e.player === opponent) expect(e.defId).toBe(HIDDEN_UID);
      }
      // Ses propres pioches restent visibles.
      expect(filtered.some((e) => e.type === 'card_drawn' && e.player === viewer && e.uid !== HIDDEN_UID)).toBe(true);
    }
  });
});
