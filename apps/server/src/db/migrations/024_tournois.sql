-- Tournoi hebdomadaire (section 7) : élimination directe, tours à échéance, simulation des matchs non joués.
CREATE TABLE tournaments (
  id UUID PRIMARY KEY,
  -- Date (UTC) du début : un tournoi par semaine.
  start_date TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'registering' CHECK (status IN ('registering', 'running', 'done', 'cancelled')),
  -- Seed du tirage du tableau et des simulations (RNG cryptographique du serveur), pour l'audit.
  seed TEXT,
  round INT NOT NULL DEFAULT 0,
  rounds INT NOT NULL DEFAULT 0,
  round_ends_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE tournament_players (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Copie figée du deck à l'inscription.
  leader_id TEXT NOT NULL,
  card_ids TEXT[] NOT NULL,
  -- Classement final (1 = champion, 2 = finaliste, 4 = demi-finaliste…) et récompense versée.
  top INT,
  reward_coins INT,
  reward_boosters INT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE tournament_matches (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INT NOT NULL,
  slot INT NOT NULL,
  player_a UUID,
  player_b UUID,
  winner UUID,
  -- 'bye' (adversaire absent du tableau), 'played' (partie en direct), 'simulated' (IA contre IA à l'échéance).
  how TEXT CHECK (how IN ('bye', 'played', 'simulated')),
  match_id UUID,
  live_started_at TIMESTAMPTZ,
  PRIMARY KEY (tournament_id, round, slot)
);
