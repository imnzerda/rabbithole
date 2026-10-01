-- Inscription protégée : alias d'e-mails, vérification par SMS, empreinte du navigateur.

-- E-mail canonique (alias « +… » retirés, points Gmail ignorés) : unicité des comptes.
-- Les comptes existants reprennent leur e-mail tel quel (déjà unique).
ALTER TABLE users ADD COLUMN canonical_email TEXT;
UPDATE users SET canonical_email = lower(email);
ALTER TABLE users ALTER COLUMN canonical_email SET NOT NULL;
CREATE UNIQUE INDEX users_canonical_email ON users(canonical_email);

-- Numéro vérifié par SMS : un numéro = un compte. Seule son empreinte salée est gardée.
ALTER TABLE users ADD COLUMN phone_hash TEXT;
ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMPTZ;
CREATE UNIQUE INDEX users_phone ON users(phone_hash);

-- Inscriptions en attente de vérification par SMS (mot de passe déjà haché, signaux hachés).
CREATE TABLE pending_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload JSONB NOT NULL,
  signals JSONB NOT NULL,
  reasons TEXT[] NOT NULL,
  phone_hash TEXT,
  code_hash TEXT,
  code_expires_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Journal des SMS envoyés (limites par numéro et par IP, coût, audit).
CREATE TABLE sms_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sms_sends_phone ON sms_sends(phone_hash, created_at);
CREATE INDEX sms_sends_ip ON sms_sends(ip_hash, created_at);
