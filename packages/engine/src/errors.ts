export type EngineErrorCode =
  | 'unknown_card_def'
  | 'unknown_card'
  | 'invalid_deck'
  | 'invalid_setup'
  | 'not_your_decision'
  | 'illegal_action'
  | 'match_ended';

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
