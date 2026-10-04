-- Tendance du jour (section 8).

-- Cartes du jour : score (vues de la veille / moyenne des 30 jours précédents), exclusions motivées.
CREATE TABLE trending (
  date TEXT NOT NULL,
  card_id TEXT NOT NULL,
  score REAL NOT NULL,
  views INT NOT NULL,
  average REAL NOT NULL,
  -- watchlist, recent_death, admin : la carte reste visible pour l'admin mais ne reçoit pas le bonus.
  excluded_reason TEXT,
  PRIMARY KEY (date, card_id)
);

-- Un calcul par jour, publié après la fenêtre de vérification de l'admin.
CREATE TABLE trending_runs (
  date TEXT PRIMARY KEY,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- Liste de surveillance : cartes à ne jamais mettre en tendance (drame, décès récent…).
CREATE TABLE trending_watchlist (
  card_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cartes en tendance pendant une partie : nécessaires pour la rejouer à l'identique.
ALTER TABLE matches ADD COLUMN trending TEXT[] NOT NULL DEFAULT '{}';
