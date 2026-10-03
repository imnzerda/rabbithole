-- Échanges libres (décision du 2026-10-03) : plusieurs cartes de chaque côté, raretés libres, dons compris.
-- Plus de limites par jour ni par semaine, plus d'interdiction entre comptes liés.
CREATE TABLE trade_items (
  trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  -- offered : donnée par l'auteur de la proposition ; requested : demandée à son ami.
  side TEXT NOT NULL CHECK (side IN ('offered', 'requested')),
  card_id TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (trade_id, side, card_id)
);

INSERT INTO trade_items (trade_id, side, card_id, quantity) SELECT id, 'offered', offered_card_id, 1 FROM trades;
INSERT INTO trade_items (trade_id, side, card_id, quantity) SELECT id, 'requested', requested_card_id, 1 FROM trades;

ALTER TABLE trades DROP COLUMN offered_card_id;
ALTER TABLE trades DROP COLUMN requested_card_id;
ALTER TABLE trades DROP COLUMN rarity;
