-- Trade-up (section 6.4) : doublons de même rareté contre une carte de la rareté supérieure.
-- Tirage côté serveur ; la seed et les cartes possibles sont enregistrées pour l'audit.
CREATE TABLE trade_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_card_ids TEXT[] NOT NULL,
  input_rarity TEXT NOT NULL,
  target_category TEXT,
  pool_card_ids TEXT[] NOT NULL,
  output_card_id TEXT NOT NULL,
  seed TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trade_ups_user ON trade_ups(user_id, created_at DESC);
