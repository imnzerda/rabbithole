import type { I18nKey as Key } from '../../i18n';

/**
 * Navigation du site : rubriques (barre latérale sur PC, barre du bas sur téléphone) et onglets des pages
 * regroupées dans une même rubrique.
 */

export type IconName = 'play' | 'cards' | 'social' | 'trophy' | 'shop' | 'flame' | 'settings' | 'more' | 'bell' | 'logout';

export interface NavTab {
  href: string;
  label: Key;
  testid: string;
  /** Autres chemins qui rendent cet onglet actif. */
  also?: string[];
}

export interface NavGroup {
  id: string;
  label: Key;
  icon: IconName;
  href: string;
  /** Dans la barre du bas sur téléphone (sinon dans « Plus »). */
  mobile: boolean;
  tabs: NavTab[];
}

export const NAV: NavGroup[] = [
  {
    id: 'play',
    label: 'nav_play',
    icon: 'play',
    href: '/',
    mobile: true,
    tabs: [
      { href: '/', label: 'nav_matches', testid: 'nav-home', also: ['/online'] },
      { href: '/daily', label: 'daily_title', testid: 'nav-daily' },
      { href: '/draft', label: 'nav_draft', testid: 'nav-draft' },
      { href: '/tournaments', label: 'nav_tournament', testid: 'nav-tournaments' },
      { href: '/replays', label: 'nav_history', testid: 'nav-replays' },
    ],
  },
  {
    id: 'collection',
    label: 'collection',
    icon: 'cards',
    href: '/collection',
    mobile: true,
    tabs: [
      { href: '/collection', label: 'nav_boosters', testid: 'nav-collection' },
      { href: '/decks', label: 'decks', testid: 'nav-decks' },
      { href: '/trade-up', label: 'tradeup_title', testid: 'nav-tradeup' },
    ],
  },
  {
    id: 'social',
    label: 'nav_social',
    icon: 'social',
    href: '/friends',
    mobile: true,
    tabs: [
      { href: '/friends', label: 'friends', testid: 'nav-friends' },
      { href: '/trades', label: 'trades', testid: 'nav-trades' },
      { href: '/guild', label: 'guild_title', testid: 'nav-guild' },
    ],
  },
  {
    id: 'progress',
    label: 'nav_progress',
    icon: 'trophy',
    href: '/missions',
    mobile: true,
    tabs: [
      { href: '/missions', label: 'missions', testid: 'nav-missions' },
      { href: '/pass', label: 'pass', testid: 'nav-pass' },
      { href: '/achievements', label: 'achievements', testid: 'nav-achievements' },
      { href: '/ranked', label: 'ranked_title', testid: 'nav-ranked' },
    ],
  },
  { id: 'shop', label: 'shop', icon: 'shop', href: '/shop', mobile: false, tabs: [] },
  { id: 'trending', label: 'trending_title', icon: 'flame', href: '/trending', mobile: false, tabs: [] },
  {
    id: 'settings',
    label: 'settings',
    icon: 'settings',
    href: '/settings',
    mobile: false,
    tabs: [
      { href: '/settings', label: 'settings', testid: 'nav-settings' },
      { href: '/credits', label: 'credits', testid: 'nav-credits' },
      { href: '/takedown', label: 'takedown', testid: 'nav-takedown' },
    ],
  },
];

/** Pages sans navigation (connexion, inscription, page de paiement factice, entraînement en plein écran). */
export const BARE_ROUTES = ['/login', '/signup', '/shop/sandbox', '/play'];

const matches = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

export function activeTab(path: string): { group: NavGroup; tab: NavTab | null } | null {
  for (const group of NAV) {
    const tab = group.tabs.find((t) => matches(path, t.href) || t.also?.some((a) => matches(path, a)));
    if (tab) return { group, tab };
    if (!group.tabs.length && matches(path, group.href)) return { group, tab: null };
  }
  return null;
}
