import type { PublicUser } from '@rabbithole/shared';
import { api } from './api';

/** Session du joueur connecté (la session elle-même est un cookie httpOnly géré par le serveur). */
export const session = $state<{ user: PublicUser | null; loaded: boolean }>({ user: null, loaded: false });

export async function loadSession(): Promise<PublicUser | null> {
  try {
    session.user = (await api.session()).user;
  } catch {
    session.user = null;
  }
  session.loaded = true;
  return session.user;
}

export async function logout(): Promise<void> {
  await api.logout().catch(() => undefined);
  session.user = null;
}
