export type EngineErrorCode =
  | 'unknown_card_def'
  | 'unknown_terrain_def'
  | 'unknown_card'
  | 'invalid_deck'
  | 'invalid_setup'
  | 'invalid_plays'
  | 'match_ended'
  | 'hype_unavailable';

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
