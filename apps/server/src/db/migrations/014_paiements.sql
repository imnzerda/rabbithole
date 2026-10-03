-- Paiements (sections 6.6 et 14) : produits, prix régionaux, transactions créditées uniquement par webhook.

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name JSONB NOT NULL,
  -- Contenu crédité au paiement, ex. {"gems": 80}.
  contents JSONB NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

-- Prix par pays, en centimes (unité mineure de la devise ; le yen n'en a pas). Pays « * » : prix par défaut.
CREATE TABLE price_tiers (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INT NOT NULL CHECK (amount > 0),
  PRIMARY KEY (product_id, country)
);

-- Une transaction naît au passage en caisse (pending) ; seul un webhook vérifié la passe à « completed »
-- et crédite le contenu. provider_transaction_id unique : un même paiement n'est jamais crédité deux fois.
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  contents JSONB NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  provider_transaction_id TEXT UNIQUE,
  amount INT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ
);
CREATE INDEX transactions_user ON transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX transactions_session ON transactions(provider, provider_session_id);

-- Événements de webhook déjà traités (idempotence, y compris pour les remboursements).
CREATE TABLE payment_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

-- Plafond de dépense mensuel choisi par le joueur (facultatif), dans la devise de son pays, en centimes.
ALTER TABLE users ADD COLUMN monthly_spend_cap INT;

-- Gemmes : 6 paliers (prix de référence en euros ; prix régionaux pour les pays de lancement).
INSERT INTO products (id, type, name, contents, sort) VALUES
  ('gems_80', 'gems', '{"fr":"Poignée de gemmes","en":"Handful of gems"}', '{"gems":80}', 1),
  ('gems_170', 'gems', '{"fr":"Sachet de gemmes","en":"Pouch of gems"}', '{"gems":170}', 2),
  ('gems_450', 'gems', '{"fr":"Bourse de gemmes","en":"Purse of gems"}', '{"gems":450}', 3),
  ('gems_950', 'gems', '{"fr":"Coffret de gemmes","en":"Box of gems"}', '{"gems":950}', 4),
  ('gems_2000', 'gems', '{"fr":"Coffre de gemmes","en":"Chest of gems"}', '{"gems":2000}', 5),
  ('gems_5200', 'gems', '{"fr":"Trésor de gemmes","en":"Hoard of gems"}', '{"gems":5200}', 6);

INSERT INTO price_tiers (product_id, country, currency, amount) VALUES
  ('gems_80', '*', 'EUR', 99), ('gems_170', '*', 'EUR', 199), ('gems_450', '*', 'EUR', 499),
  ('gems_950', '*', 'EUR', 999), ('gems_2000', '*', 'EUR', 1999), ('gems_5200', '*', 'EUR', 4999),
  ('gems_80', 'US', 'USD', 99), ('gems_170', 'US', 'USD', 199), ('gems_450', 'US', 'USD', 499),
  ('gems_950', 'US', 'USD', 999), ('gems_2000', 'US', 'USD', 1999), ('gems_5200', 'US', 'USD', 4999),
  ('gems_80', 'CA', 'CAD', 129), ('gems_170', 'CA', 'CAD', 279), ('gems_450', 'CA', 'CAD', 699),
  ('gems_950', 'CA', 'CAD', 1399), ('gems_2000', 'CA', 'CAD', 2799), ('gems_5200', 'CA', 'CAD', 6999),
  ('gems_80', 'GB', 'GBP', 89), ('gems_170', 'GB', 'GBP', 179), ('gems_450', 'GB', 'GBP', 449),
  ('gems_950', 'GB', 'GBP', 899), ('gems_2000', 'GB', 'GBP', 1799), ('gems_5200', 'GB', 'GBP', 4499),
  ('gems_80', 'CH', 'CHF', 100), ('gems_170', 'CH', 'CHF', 200), ('gems_450', 'CH', 'CHF', 500),
  ('gems_950', 'CH', 'CHF', 1000), ('gems_2000', 'CH', 'CHF', 2000), ('gems_5200', 'CH', 'CHF', 5000),
  ('gems_80', 'PL', 'PLN', 299), ('gems_170', 'PL', 'PLN', 599), ('gems_450', 'PL', 'PLN', 1499),
  ('gems_950', 'PL', 'PLN', 2999), ('gems_2000', 'PL', 'PLN', 5999), ('gems_5200', 'PL', 'PLN', 14999),
  ('gems_80', 'BR', 'BRL', 290), ('gems_170', 'BR', 'BRL', 590), ('gems_450', 'BR', 'BRL', 1490),
  ('gems_950', 'BR', 'BRL', 2990), ('gems_2000', 'BR', 'BRL', 5990), ('gems_5200', 'BR', 'BRL', 14990),
  ('gems_80', 'MX', 'MXN', 1900), ('gems_170', 'MX', 'MXN', 3900), ('gems_450', 'MX', 'MXN', 9900),
  ('gems_950', 'MX', 'MXN', 19900), ('gems_2000', 'MX', 'MXN', 39900), ('gems_5200', 'MX', 'MXN', 99900),
  ('gems_80', 'JP', 'JPY', 160), ('gems_170', 'JP', 'JPY', 320), ('gems_450', 'JP', 'JPY', 800),
  ('gems_950', 'JP', 'JPY', 1600), ('gems_2000', 'JP', 'JPY', 3200), ('gems_5200', 'JP', 'JPY', 8000),
  ('gems_80', 'PH', 'PHP', 5500), ('gems_170', 'PH', 'PHP', 11000), ('gems_450', 'PH', 'PHP', 27500),
  ('gems_950', 'PH', 'PHP', 55000), ('gems_2000', 'PH', 'PHP', 110000), ('gems_5200', 'PH', 'PHP', 275000);
