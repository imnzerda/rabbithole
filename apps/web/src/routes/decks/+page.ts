import { loadCatalog } from '$lib/catalog';

// Catalogue publié par le serveur (cartes en base, phase 4).
export const load = async () => ({ catalog: await loadCatalog() });
