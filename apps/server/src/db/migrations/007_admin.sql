-- Phase 4, outil d'administration : candidats du pipeline, revue de la politique de contenu, journal d'audit.

-- Candidats importés depuis le pipeline (`tools/pipeline/out/<série>.json`).
CREATE TABLE candidates (
  qid TEXT PRIMARY KEY,
  run_series TEXT NOT NULL,
  data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'shortlisted', 'rejected', 'carded')),
  primary_category TEXT,
  policy_status TEXT,
  score REAL,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX candidates_filter ON candidates(primary_category, status, policy_status);

-- Politique de contenu (section 5) : une carte « à revoir » n'est publiée qu'après validation humaine.
ALTER TABLE cards ADD COLUMN policy_status TEXT NOT NULL DEFAULT 'ok' CHECK (policy_status IN ('ok', 'needs_review', 'excluded'));
ALTER TABLE cards ADD COLUMN policy_reasons TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE cards ADD COLUMN policy_cleared_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cards ADD COLUMN policy_note TEXT;

-- Journal d'audit de toutes les actions d'administration (section 12).
CREATE TABLE admin_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON admin_audit(created_at DESC);
