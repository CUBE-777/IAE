/**
 * src/features/games/constants/gamesCore.js — ثوابت نواة الألعاب (المرحلة 2: 0050).
 * ملف مستقل كي لا نمسّ constants/games.js (المرحلة 1).
 */

export const GAME_STATUS = { draft: 'draft', published: 'published', archived: 'archived' };
export const ATTEMPT_STATUS = { inProgress: 'in_progress', submitted: 'submitted', expired: 'expired' };
export const POINTS_REASON = { challengeSolved: 'challenge_solved', achievement: 'achievement', adminAdjustment: 'admin_adjustment' };

/** ترتيب الاحتياط عند غياب ترجمة اللغة المطلوبة في الحقول jsonb. */
export const GAMES_LANG_FALLBACK = ['ar', 'en', 'fr'];

/** رموز الأخطاء التي ترفعها دوال 0050 (نص الاستثناء نفسه). أي رمز آخر = unknown. */
export const GAMES_ERROR_CODES = [
  'games_access_denied',
  'challenge_not_available',
  'challenge_not_open',
  'max_attempts_reached',
  'rate_limited',
  'invalid_answer',
  'attempt_not_found',
  'attempt_already_finished',
  'verification_unavailable',
  'invalid_delta',
  'note_required',
  'user_not_found',
  // 6.4: مسارات التعلم وبدء محاولة في مرحلة
  'stage_not_available',
  'stage_locked',
  'path_not_available',
];
export const GAMES_UNKNOWN_ERROR = 'unknown';
