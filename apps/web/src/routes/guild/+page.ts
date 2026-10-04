import { loadViewerCatalog } from '$lib/viewer.svelte';

// Catalogue publié par le serveur, tel que ce joueur le voit (cartes masquées, bloquées dans son pays).
export const load = async () => ({ catalog: await loadViewerCatalog() });
