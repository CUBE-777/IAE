/**
 * src/features/games/constants/games.js — ثوابت وحدة IAE Games (المرحلة 1: الأساس).
 * المسارات والأسباب في مكان واحد ليستعملها الراوتر والحارس وروابط الدخول.
 */

export const GAMES_BASE_PATH = '/games';

/** مسارات الوحدة. المراحل اللاحقة تضيف هنا مفاتيح جديدة فقط. */
export const GAMES_PATHS = {
  home: GAMES_BASE_PATH,
  profile: `${GAMES_BASE_PATH}/profile`,
  leaderboard: `${GAMES_BASE_PATH}/leaderboard`,
  game: (slug) => `${GAMES_BASE_PATH}/g/${encodeURIComponent(slug)}`,
  challenge: (id) => `${GAMES_BASE_PATH}/c/${encodeURIComponent(id)}`,
  // مسارات التعلم (6.4): المسار ← (الفئة داخل صفحة المسار) ← المرحلة
  paths: `${GAMES_BASE_PATH}/paths`,
  track: (id, categoryId) => `${GAMES_BASE_PATH}/paths/${encodeURIComponent(id)}${categoryId ? `#cat-${encodeURIComponent(categoryId)}` : ''}`,
  stage: (id) => `${GAMES_BASE_PATH}/stages/${encodeURIComponent(id)}`,
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
