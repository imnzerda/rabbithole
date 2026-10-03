-- Missions quotidiennes et hebdomadaires (section 13) : tirées par le serveur pour chaque joueur et chaque
-- période, progression comptée côté serveur, récompense réclamée une seule fois.
CREATE TABLE user_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('daily', 'weekly')),
  -- Jour (AAAA-MM-JJ) ou lundi de la semaine, en UTC.
  period_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT,
  target INT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  coins INT NOT NULL,
  xp INT NOT NULL,
  seed TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ
);
CREATE INDEX user_missions_current ON user_missions(user_id, period, period_key);
