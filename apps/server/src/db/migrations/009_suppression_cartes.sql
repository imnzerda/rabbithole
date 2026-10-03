-- Une carte déjà publiée a pu être obtenue par des joueurs : elle se retire du jeu, elle ne s'efface jamais.
ALTER TABLE cards ADD COLUMN published_once BOOLEAN NOT NULL DEFAULT false;
UPDATE cards SET published_once = true WHERE status IN ('published', 'retired');
