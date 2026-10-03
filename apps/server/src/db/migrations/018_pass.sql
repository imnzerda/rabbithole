-- Pass saisonnier (section 6.6) et premiers cosmétiques.

-- Boosters à aperçu offerts (récompenses des pistes payantes) : ouvrent exactement l'aperçu affiché.
ALTER TABLE wallets ADD COLUMN preview_boosters INT NOT NULL DEFAULT 0 CHECK (preview_boosters >= 0);

-- Récompenses d'une saison, figées à la première demande (le catalogue peut évoluer en cours de saison).
CREATE TABLE pass_seasons (
  season INT PRIMARY KEY,
  rewards JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Progression d'un joueur dans une saison : points, piste achetée, niveaux réclamés par piste.
CREATE TABLE user_pass (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season INT NOT NULL,
  xp INT NOT NULL DEFAULT 0,
  track TEXT NOT NULL DEFAULT 'free' CHECK (track IN ('free', 'premium', 'deluxe')),
  claimed JSONB NOT NULL DEFAULT '{"free": [], "premium": [], "deluxe": []}',
  PRIMARY KEY (user_id, season)
);

-- Titres de profil (cosmétiques).
CREATE TABLE user_titles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL,
  name JSONB NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_id)
);
ALTER TABLE users ADD COLUMN active_title TEXT;

-- Variantes de cartes possédées ; au plus une affichée (equipped) par carte.
CREATE TABLE user_card_variants (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  equipped BOOLEAN NOT NULL DEFAULT false,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id, variant)
);

-- Pistes payantes, achetées directement en argent réel (pas en gemmes). La saison est fixée au passage en caisse.
INSERT INTO products (id, type, name, contents, sort) VALUES
  ('pass_premium', 'pass', '{"fr":"Pass premium","en":"Premium pass"}', '{"pass":"premium"}', 101),
  ('pass_deluxe', 'pass', '{"fr":"Pass deluxe","en":"Deluxe pass"}', '{"pass":"deluxe"}', 102),
  ('pass_upgrade', 'pass', '{"fr":"Du premium au deluxe","en":"Premium to deluxe"}', '{"pass":"deluxe"}', 103);

INSERT INTO price_tiers (product_id, country, currency, amount) VALUES
  ('pass_premium', '*', 'EUR', 999), ('pass_deluxe', '*', 'EUR', 1499), ('pass_upgrade', '*', 'EUR', 500),
  ('pass_premium', 'US', 'USD', 999), ('pass_deluxe', 'US', 'USD', 1499), ('pass_upgrade', 'US', 'USD', 499),
  ('pass_premium', 'CA', 'CAD', 1299), ('pass_deluxe', 'CA', 'CAD', 1999), ('pass_upgrade', 'CA', 'CAD', 699),
  ('pass_premium', 'GB', 'GBP', 899), ('pass_deluxe', 'GB', 'GBP', 1299), ('pass_upgrade', 'GB', 'GBP', 449),
  ('pass_premium', 'CH', 'CHF', 1000), ('pass_deluxe', 'CH', 'CHF', 1500), ('pass_upgrade', 'CH', 'CHF', 500),
  ('pass_premium', 'PL', 'PLN', 4499), ('pass_deluxe', 'PL', 'PLN', 6499), ('pass_upgrade', 'PL', 'PLN', 2199),
  ('pass_premium', 'BR', 'BRL', 4990), ('pass_deluxe', 'BR', 'BRL', 7490), ('pass_upgrade', 'BR', 'BRL', 2490),
  ('pass_premium', 'MX', 'MXN', 19900), ('pass_deluxe', 'MX', 'MXN', 29900), ('pass_upgrade', 'MX', 'MXN', 9900),
  ('pass_premium', 'JP', 'JPY', 1600), ('pass_deluxe', 'JP', 'JPY', 2400), ('pass_upgrade', 'JP', 'JPY', 800),
  ('pass_premium', 'PH', 'PHP', 54900), ('pass_deluxe', 'PH', 'PHP', 79900), ('pass_upgrade', 'PH', 'PHP', 24900);
