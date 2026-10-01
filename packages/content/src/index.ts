import { createContext, type CardDef, type LocalizedText, type MatchContext, type RulesOverride, type TerrainDef } from '@rabbithole/engine';
import cardsJson from '../data/prototype/cards.json';
import decksJson from '../data/prototype/decks.json';
import terrainsJson from '../data/prototype/terrains.json';

/** Contenu du prototype (phase 2) : archétypes fictifs, pas encore de personnes réelles. */

export interface PrebuiltDeck {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  cards: string[];
}

export const PROTOTYPE_CARDS = cardsJson as CardDef[];
export const PROTOTYPE_TERRAINS = terrainsJson as TerrainDef[];
export const PROTOTYPE_DECKS = decksJson as PrebuiltDeck[];

/** Cartes à collectionner (hors jetons générés en cours de partie). */
export const COLLECTIBLE_CARDS = PROTOTYPE_CARDS.filter((c) => c.series === 'prototype');

export function prototypeContext(rules?: RulesOverride): MatchContext {
  return createContext({ cards: PROTOTYPE_CARDS, terrains: PROTOTYPE_TERRAINS, rules });
}
