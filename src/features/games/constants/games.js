/**
 * src/features/games/constants/games.js — ثوابت وحدة IAE Games (المرحلة 1: الأساس).
 * المسارات والأسباب في مكان واحد ليستعملها الراوتر والحارس وروابط الدخول.
 */

export const GAMES_BASE_PATH = '/games';

/** مسارات الوحدة. المراحل اللاحقة تضيف هنا مفاتيح جديدة فقط. */
export const GAMES_PATHS = {
  home: GAMES_BASE_PATH,
};

/** أسباب get_games_access() (0049) كما تعيدها الدالة. أي قيمة أخرى تُعامل كـ unknown (رفض). */
export const GAMES_ACCESS_REASONS = [
  'admin',
  'member',
  'unauthenticated',
  'mfa_required',
  'password_change_required',
  'no_member_account',
  'no_season',
  'member_inactive',
  'membership_not_paid',
];

export const GAMES_UNKNOWN_REASON = 'unknown';
