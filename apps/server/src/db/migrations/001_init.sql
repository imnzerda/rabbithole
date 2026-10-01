-- Phase 3 : comptes, sessions, collections, decks, parties (section 16 du cahier des charges).

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  country TEXT NOT NULL,
  locale TEXT NOT NULL,
  auth_provider TEXT NOT NULL DEFAULT 'password',
  status TEXT NOT NULL DEFAULT 'active'
);

-- Jetons de session opaques : seul leur empreinte SHA-256 est stockée.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE collections (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity >= 0),
  variants JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  leader_id TEXT NOT NULL,
  card_ids TEXT[] NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decks_user ON decks(user_id);

-- Une partie se rejoue à l'identique avec : version du contenu, seed, decks, actions.
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL,
  player_a UUID REFERENCES users(id) ON DELETE SET NULL,
  player_b UUID REFERENCES users(id) ON DELETE SET NULL,
  ghost BOOLEAN NOT NULL DEFAULT false,
  players JSONB NOT NULL,
  seed TEXT NOT NULL,
  content_version TEXT NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX matches_player_a ON matches(player_a, created_at DESC);
CREATE INDEX matches_player_b ON matches(player_b, created_at DESC);
