-- Vie de guilde (section 13) : XP et niveaux, demandes de cartes et dons, tableau d'échanges.

-- XP apportée par chaque membre (au total, et du jour pour le plafond quotidien).
ALTER TABLE guild_members ADD COLUMN xp INT NOT NULL DEFAULT 0;
ALTER TABLE guild_members ADD COLUMN xp_day TEXT;
ALTER TABLE guild_members ADD COLUMN xp_today INT NOT NULL DEFAULT 0;

-- Demandes de cartes : un membre demande quelques exemplaires d'une carte, les autres en donnent.
CREATE TABLE guild_card_requests (
  id UUID PRIMARY KEY,
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  wanted INT NOT NULL,
  received INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX guild_card_requests_guild ON guild_card_requests(guild_id, expires_at);
CREATE INDEX guild_card_requests_user ON guild_card_requests(user_id, created_at DESC);

CREATE TABLE guild_card_donations (
  request_id UUID NOT NULL REFERENCES guild_card_requests(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guild_card_donations_request ON guild_card_donations(request_id);

-- Tableau d'échanges : « je cherche » / « je propose ».
CREATE TABLE guild_board_posts (
  id UUID PRIMARY KEY,
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('seek', 'offer')),
  card_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guild_board_posts_guild ON guild_board_posts(guild_id, created_at DESC);
