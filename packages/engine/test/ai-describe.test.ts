import { describe, expect, it } from 'vitest';
import {
  aiWantsHype,
  cardText,
  chooseAiPlays,
  createContext,
  createMatch,
  declareHype,
  effectText,
  resolveTurn,
  Rng,
  validatePlays,
  type MatchState,
  type PlayerIndex,
  type TurnSubmission,
} from '../src/index.js';
import { POOL, TERRAINS } from './fixtures.js';
import { randomSubmission } from './helpers.js';

const ctx = createContext({ cards: POOL, terrains: TERRAINS });

function play(seed: string, pick: (s: MatchState, p: PlayerIndex, rng: Rng) => TurnSubmission, hype = false) {
  const rng = Rng.fromSeed(`bots-${seed}`);
  const deck = () => rng.shuffle(POOL.map((c) => c.id).filter((id) => id !== 'p_token')).slice(0, 12);
  let { state } = createMatch(ctx, { seed, players: [{ id: 'A', deck: deck() }, { id: 'B', deck: deck() }] });
  while (state.phase === 'planning') {
    if (hype && aiWantsHype(ctx, state, 0)) state = declareHype(ctx, state, 0).state;
    const subs: [TurnSubmission, TurnSubmission] = [pick(state, 0, rng), pick(state, 1, rng)];
    for (const p of [0, 1] as PlayerIndex[]) expect(validatePlays(ctx, state, p, subs[p])).toEqual([]);
    state = resolveTurn(ctx, state, subs).state;
  }
  return state;
}

describe('IA simple', () => {
  it('produit toujours des poses valides et dépense son mana', () => {
    const s = play('ai-valid', (st, p, rng) => chooseAiPlays(ctx, st, p, rng));
    expect(s.phase).toBe('ended');
  });

  it('bat largement un joueur aléatoire', () => {
    let wins = 0;
    const games = 150;
    for (let i = 0; i < games; i++) {
      const s = play(`vs-random-${i}`, (st, p, rng) => (p === 0 ? chooseAiPlays(ctx, st, p, rng) : randomSubmission(ctx, st, p, rng)));
      if (s.result?.winner === 0) wins++;
    }
    expect(wins / games).toBeGreaterThan(0.7);
  });

  it('est déterministe pour un même RNG', () => {
    const a = play('ai-det', (st, p, rng) => chooseAiPlays(ctx, st, p, rng), true);
    const b = play('ai-det', (st, p, rng) => chooseAiPlays(ctx, st, p, rng), true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('texte des cartes', () => {
  it("exemple du cahier des charges", () => {
    expect(
      effectText({
        trigger: 'on_reveal',
        condition: { type: 'terrain_has_category', category: 'musique', min: 2 },
        action: { type: 'add_power', target: 'self', amount: 3 },
      }),
    ).toBe("À la révélation : Gagne +3 s'il y a au moins 2 autre(s) carte(s) Musique ici.");
  });

  it('anglais', () => {
    expect(effectText({ trigger: 'continuous', action: { type: 'add_power', target: 'allies_here', amount: 1 } }, 'en')).toBe(
      'Ongoing: +1 to your other cards here.',
    );
  });

  it('chaque carte du pool a un texte lisible (sans id brut ni undefined)', () => {
    for (const def of POOL) {
      for (const l of ['fr', 'en'] as const) {
        for (const line of cardText(ctx, def, l)) {
          expect(line.text).not.toMatch(/undefined|\[object/);
          expect(line.text.length).toBeGreaterThan(5);
        }
      }
    }
    expect(cardText(ctx, POOL.find((c) => c.id === 'p_transformer')!, 'fr')[0]?.text).toContain('en p_token');
  });
});
