-- Decks de référence des séries (équilibrés par simulation) : entraînement contre l'IA et fantômes de repli.
CREATE TABLE series_decks (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  name JSONB NOT NULL,
  description JSONB NOT NULL DEFAULT '{}',
  leader_id TEXT NOT NULL,
  card_ids TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
