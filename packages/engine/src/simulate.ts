import { chooseAction } from './ai.js';
import type { MatchContext } from './context.js';
import { applyAction, createMatch, pendingDecision } from './match.js';
import { Rng } from './rng.js';
import type { PlayerIndex } from './types.js';

/**
 * Simulations IA contre IA (section 12, équilibrage) : deux decks s'affrontent N fois,
 * en alternant qui commence. Déterministe pour un même préfixe de seed.
 */

export interface SimDeck {
  leader: string;
  deck: string[];
}

export interface SimulationResult {
  games: number;
  /** Victoires du deck A, du deck B, égalités. */
  winsA: number;
  winsB: number;
  draws: number;
  /** Part des victoires du premier joueur (avantage à commencer). */
  firstPlayerWinRate: number;
  averageTurns: number;
}

export function simulateMatchup(ctx: MatchContext, a: SimDeck, b: SimDeck, games: number, seedPrefix = 'sim', maxSteps = 3000): SimulationResult {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let firstWins = 0;
  let turns = 0;
  for (let g = 0; g < games; g++) {
    // Une partie sur deux, le deck B joue en premier (siège 0).
    const swap = g % 2 === 1;
    const seats: [SimDeck, SimDeck] = swap ? [b, a] : [a, b];
    const rng = Rng.fromSeed(`${seedPrefix}:ai:${g}`);
    let { state } = createMatch(ctx, {
      seed: `${seedPrefix}:${g}`,
      players: [
        { id: 'A', ...seats[0] },
        { id: 'B', ...seats[1] },
      ],
    });
    for (let i = 0; i < maxSteps && state.phase !== 'ended'; i++) {
      const d = pendingDecision(state);
      if (!d) break;
      const action = chooseAction(ctx, state, d.player, rng);
      if (!action) break;
      state = applyAction(ctx, state, d.player, action).state;
    }
    const r = state.result;
    turns += r?.turns ?? state.turn;
    if (!r || r.winner === null) {
      draws++;
      continue;
    }
    const winnerDeckIsA = (r.winner === 0) !== swap;
    if (winnerDeckIsA) winsA++;
    else winsB++;
    if (r.winner === (state.first as PlayerIndex)) firstWins++;
  }
  const decided = winsA + winsB;
  return {
    games,
    winsA,
    winsB,
    draws,
    firstPlayerWinRate: decided ? Math.round((firstWins / decided) * 1000) / 10 : 0,
    averageTurns: games ? Math.round((turns / games) * 10) / 10 : 0,
  };
}
