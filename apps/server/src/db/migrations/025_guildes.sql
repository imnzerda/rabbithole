-- Guildes (section 13) : une guilde par joueur, rôles chef / adjoints / membres, entrée libre ou sur demande.
CREATE TABLE guilds (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  -- Nom normalisé (minuscules, espaces réduits) : unicité insensible à la casse.
  name_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  -- Emblème : une catégorie du jeu (couleur et symbole).
  emblem TEXT NOT NULL,
  language TEXT NOT NULL,
  open BOOLEAN NOT NULL DEFAULT true,
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE guild_members (
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  -- Une seule guilde par joueur.
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
  tokens INT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guild_members_guild ON guild_members(guild_id);
-- Un seul chef par guilde.
CREATE UNIQUE INDEX guild_members_leader ON guild_members(guild_id) WHERE role = 'leader';

CREATE TABLE guild_join_requests (
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);
