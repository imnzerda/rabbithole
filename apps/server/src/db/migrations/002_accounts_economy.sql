-- Comptes sans date de naissance (déclaration 21+), anti-double compte, économie de base (boosters).

-- Déclaration d'âge au lieu de la date de naissance : aucune donnée personnelle superflue.
ALTER TABLE users DROP COLUMN birth_date;
ALTER TABLE users ADD COLUMN age_confirmed_at TIMESTAMPTZ;

-- E-mail canonique (casse, alias « +tag », points Gmail) : un même e-mail ne crée qu'un compte.
ALTER TABLE users ADD COLUMN canonical_email TEXT;
UPDATE users SET canonical_email = lower(email);
ALTER TABLE users ALTER COLUMN canonical_email SET NOT NULL;
CREATE UNIQUE INDEX users_canonical_email ON users(canonical_email);

-- Empreinte (hachée, salée) de l'IP d'inscription : limite le nombre de comptes par réseau.
ALTER TABLE users ADD COLUMN signup_ip_hash TEXT;
CREATE INDEX users_signup_ip ON users(signup_ip_hash, created_at);

-- Leader de départ choisi par le joueur (une seule fois).
ALTER TABLE users ADD COLUMN starter_leader TEXT;

-- Appareils et réseaux vus pour chaque compte (identifiants hachés).
CREATE TABLE user_devices (
  device_hash TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_hash, user_id)
);
CREATE INDEX user_devices_device ON user_devices(device_hash);

CREATE TABLE user_ips (
  ip_hash TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_hash, user_id)
);
CREATE INDEX user_ips_ip ON user_ips(ip_hash);

-- Signalements à revoir (outil d'admin, phase 4) : comptes liés par un appareil ou un réseau.
CREATE TABLE account_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, other_user_id, reason)
);

-- Portefeuille (section 6.1). Les pièces et l'essence ne s'achètent pas.
CREATE TABLE wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins INT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  gems INT NOT NULL DEFAULT 0 CHECK (gems >= 0),
  essence INT NOT NULL DEFAULT 0 CHECK (essence >= 0),
  guild_tokens INT NOT NULL DEFAULT 0 CHECK (guild_tokens >= 0),
  free_boosters INT NOT NULL DEFAULT 0 CHECK (free_boosters >= 0)
);
INSERT INTO wallets (user_id) SELECT id FROM users;

-- Journal de toutes les variations de monnaie (audit, plafonds journaliers).
CREATE TABLE coin_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount INT NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX coin_ledger_user ON coin_ledger(user_id, created_at DESC);

-- Aperçu exact du prochain booster de chaque type, verrouillé côté serveur (section 6.2).
CREATE TABLE booster_previews (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booster_type TEXT NOT NULL,
  card_ids TEXT[] NOT NULL,
  seed TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, booster_type)
);

-- Chaque ouverture est enregistrée avec sa seed (audit des tirages).
CREATE TABLE booster_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booster_type TEXT NOT NULL,
  source TEXT NOT NULL,
  price INT NOT NULL DEFAULT 0,
  card_ids TEXT[] NOT NULL,
  seed TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booster_openings_user ON booster_openings(user_id, created_at DESC);

-- Récompenses attribuées à la fin de chaque partie.
ALTER TABLE matches ADD COLUMN rewards JSONB;
