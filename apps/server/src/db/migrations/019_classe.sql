-- Classé (section 7) : points de classement par saison mensuelle ('AAAA-MM', UTC).
CREATE TABLE ranked (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  best_points INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  -- Récompense de fin de saison déjà versée (au début de la saison suivante).
  rewarded BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season)
);
CREATE INDEX ranked_board ON ranked(season, points DESC, updated_at);
