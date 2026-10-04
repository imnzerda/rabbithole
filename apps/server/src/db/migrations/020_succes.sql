-- Succès et progression de collection (section 13). La progression est calculée à partir des données
-- du joueur ; on n'enregistre que ce qui a été réclamé.
CREATE TABLE user_achievements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

-- Niveaux de la progression de collection déjà réclamés.
ALTER TABLE users ADD COLUMN collection_level_claimed INT NOT NULL DEFAULT 0;
