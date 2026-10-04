-- Draft du week-end (section 7) : choix du Leader, puis des cartes une à une, puis parties jusqu'à N victoires ou M défaites.
CREATE TABLE draft_runs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Samedi de la semaine (UTC) : l'entrée gratuite vaut une fois par week-end.
  week TEXT NOT NULL,
  entry TEXT NOT NULL CHECK (entry IN ('free', 'coins')),
  -- Seed (RNG cryptographique du serveur) dont dérivent toutes les propositions, pour l'audit.
  seed TEXT NOT NULL,
  leader_choices TEXT[] NOT NULL,
  leader_id TEXT,
  offer TEXT[] NOT NULL DEFAULT '{}',
  picks TEXT[] NOT NULL DEFAULT '{}',
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'picking' CHECK (status IN ('picking', 'playing', 'done')),
  reward_coins INT,
  reward_boosters INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
-- Un seul draft en cours par joueur.
CREATE UNIQUE INDEX draft_runs_active ON draft_runs(user_id) WHERE status <> 'done';
CREATE INDEX draft_runs_week ON draft_runs(user_id, week);
