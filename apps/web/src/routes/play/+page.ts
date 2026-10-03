import { loadPractice } from '$lib/practice';

// Decks proposés pour l'entraînement (série publiée, sinon prototype).
export const load = async () => ({ practice: await loadPractice() });
