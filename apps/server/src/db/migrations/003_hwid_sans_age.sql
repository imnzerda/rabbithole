-- Plus de condition d'âge (un système de signalement et un interrupteur « contenu sensible » viendront).
ALTER TABLE users DROP COLUMN age_confirmed_at;

-- L'anti-double compte repose sur l'appareil : plus de plafond par réseau ni d'e-mail canonique.
DROP INDEX users_signup_ip;
ALTER TABLE users DROP COLUMN signup_ip_hash;
DROP INDEX users_canonical_email;
ALTER TABLE users DROP COLUMN canonical_email;

-- Deux signaux d'appareil, toujours hachés et salés :
--   « cookie » : identifiant posé par le serveur (un navigateur) ;
--   « hwid »   : empreinte matérielle calculée par le navigateur (résiste à l'effacement des cookies).
ALTER TABLE user_devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'cookie';
