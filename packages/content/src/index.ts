import { createContext, type CardDef, type LocalizedText, type MatchContext, type RulesOverride } from '@rabbithole/engine';
import cardsJson from '../data/prototype/cards.json';
import decksJson from '../data/prototype/decks.json';

/** Contenu du prototype : archétypes fictifs (les personnes réelles arrivent avec le pipeline, phase 4). */

export interface PrebuiltDeck {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  leader: string;
  cards: string[];
}

export const PROTOTYPE_CARDS = cardsJson as CardDef[];
export const PROTOTYPE_DECKS = decksJson as PrebuiltDeck[];

export const LEADER_CARDS = PROTOTYPE_CARDS.filter((c) => c.type === 'leader');
/** Cartes à collectionner hors Leaders et jetons générés en partie. */
export const COLLECTIBLE_CARDS = PROTOTYPE_CARDS.filter((c) => c.type !== 'leader' && c.series === 'prototype');

export function prototypeContext(rules?: RulesOverride): MatchContext {
  return createContext({ cards: PROTOTYPE_CARDS, rules });
}
