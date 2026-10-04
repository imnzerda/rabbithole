import type { NoticeDto } from '@rabbithole/shared';
import { loc, t } from './i18n';

/** Texte d'une notification (vide si le type est inconnu : elle n'est pas affichée). */
export function noticeText(n: NoticeDto): string {
  if (n.kind === 'card_retired') {
    const p = n.payload as { name: Record<string, string>; quantity: number; coins: number };
    return t('notice_card_retired', { name: loc(p.name), coins: p.coins, n: p.quantity });
  }
  if (n.kind === 'ranked_season') {
    const p = n.payload as { season: string; rank: string; coins: number; title: Record<string, string> | null };
    return t(p.title ? 'notice_ranked_title' : 'notice_ranked', { s: p.season, r: t(`rank_${p.rank as 'lurker'}`), n: p.coins, title: p.title ? loc(p.title) : '' });
  }
  if (n.kind === 'guild_joined' || n.kind === 'guild_kicked') {
    const p = n.payload as { guild: string };
    return t(`notice_${n.kind}`, { guild: p.guild });
  }
  if (n.kind === 'guild_role') {
    const p = n.payload as { guild: string; role: 'leader' | 'officer' | 'member' };
    return t('notice_guild_role', { guild: p.guild, role: t(`guild_role_${p.role}`) });
  }
  return '';
}
