-- Amis et échanges entre joueurs (section 6.5). Les guildes viendront en phase 7.

-- Code ami : les pseudos ne sont pas uniques ; ce code permet d'ajouter un joueur sans ambiguïté.
ALTER TABLE users ADD COLUMN friend_code TEXT;
UPDATE users SET friend_code = upper(substr(md5(id::text || random()::text), 1, 8)) WHERE friend_code IS NULL;
ALTER TABLE users ALTER COLUMN friend_code SET DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8));
ALTER TABLE users ALTER COLUMN friend_code SET NOT NULL;
CREATE UNIQUE INDEX users_friend_code ON users(friend_code);

-- Demande d'amitié, puis amitié une fois acceptée (pas de délai avant de pouvoir échanger).
CREATE TABLE friendships (
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX friendships_addressee ON friendships(addressee_id);

-- Échange 1 contre 1, même rareté, cartes uniquement : proposé, puis accepté, refusé, annulé ou expiré.
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offered_card_id TEXT NOT NULL,
  requested_card_id TEXT NOT NULL,
  rarity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX trades_from ON trades(from_user, created_at DESC);
CREATE INDEX trades_to ON trades(to_user, created_at DESC);
