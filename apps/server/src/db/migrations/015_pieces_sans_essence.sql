-- Une seule monnaie gagnée en jeu (décision du 2026-10-03) : l'essence est fusionnée dans les pièces,
-- à 1 pour 1. Le recyclage rapporte désormais des pièces et la fabrication en coûte.
UPDATE wallets SET coins = coins + essence;
ALTER TABLE wallets DROP COLUMN essence;
UPDATE coin_ledger SET currency = 'coins' WHERE currency = 'essence';

-- Un remboursement ou une rétrofacturation retire les gemmes même déjà dépensées : le solde peut devenir
-- négatif (les achats en gemmes exigent toujours un solde suffisant).
ALTER TABLE wallets DROP CONSTRAINT wallets_gems_check;
