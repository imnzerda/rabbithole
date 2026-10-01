-- Phase 4 : le catalogue de cartes passe en base (section 16). Le serveur ne joue que les cartes publiées.

-- Rôle des comptes : l'outil d'administration est réservé aux admins.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin'));

-- Séries : prototype, set de base, séries mondiales et pays ; « tokens » = cartes créées en partie (jamais à collectionner).
CREATE TABLE series (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('prototype', 'tokens', 'base', 'world', 'country')),
  country TEXT,
  name JSONB NOT NULL,
  release_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cartes : la définition jouable (CardDef du moteur) est stockée telle quelle, validée par le moteur.
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES series(id),
  wikidata_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'retired')),
  def JSONB NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cards_series ON cards(series_id);
CREATE INDEX cards_status ON cards(status);
CREATE INDEX cards_wikidata ON cards(wikidata_id);

-- Images libres (section 10) : crédit complet obligatoire.
CREATE TABLE card_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  file_page TEXT NOT NULL,
  author TEXT NOT NULL,
  license TEXT NOT NULL,
  license_url TEXT,
  modified BOOLEAN NOT NULL DEFAULT true,
  personality_warning BOOLEAN NOT NULL DEFAULT false,
  r2_key TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX card_images_card ON card_images(card_id);

-- Chaque version publiée du catalogue est conservée : un replay se rejoue avec les cartes de sa partie.
CREATE TABLE catalog_versions (
  version TEXT PRIMARY KEY,
  cards JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
