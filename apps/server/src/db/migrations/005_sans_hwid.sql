-- Le HWID est abandonné : l'appareil est reconnu par son empreinte numérique (et le cookie d'appareil).
DELETE FROM user_devices WHERE kind = 'hwid';
