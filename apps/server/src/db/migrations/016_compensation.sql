-- Notifications aux joueurs (première utilisation : compensation d'une carte retirée du jeu, section 5).
CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX notices_user ON notices(user_id, created_at DESC);

-- Cartes publiées directement (graine du prototype) sans être marquées : une carte publiée n'est jamais effacée.
UPDATE cards SET published_once = true WHERE status IN ('published', 'retired');
