-- Phase 4, côté joueur : contenu sensible, signalements, demandes de retrait, règles par pays (sections 5, 9, 12).

-- Interrupteur « contenu sensible » : masqué par défaut (affichage seulement, le jeu ne change pas).
ALTER TABLE users ADD COLUMN show_sensitive BOOLEAN NOT NULL DEFAULT false;

-- Signalements des joueurs : une carte, ou l'adversaire d'une partie.
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('card', 'player')),
  card_id TEXT,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  match_id UUID,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX reports_status ON reports(status, created_at);

-- Demandes de retrait (section 5) : formulaire public, traitement sous 72 h.
CREATE TABLE takedown_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_contact TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('self', 'representative', 'rights_holder', 'other')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'rejected')),
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '72 hours',
  resolved_at TIMESTAMPTZ
);
CREATE INDEX takedown_status ON takedown_requests(status, due_at);

-- Règles par pays (section 9) : contenu adulte, contenu politique, cartes bloquées.
CREATE TABLE country_rules (
  country TEXT PRIMARY KEY,
  allow_adult BOOLEAN NOT NULL DEFAULT true,
  allow_political BOOLEAN NOT NULL DEFAULT true,
  blocked_card_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
