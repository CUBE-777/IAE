/**
 * src/features/games/admin/constants/gamesAdmin.js — ثوابت لوحة إدارة الألعاب (المرحلة 3: 0052).
 * ملف مستقل كي لا نمسّ constants/gamesCore.js (المرحلة 2).
 */
import { GAMES_ERROR_CODES } from '../../constants/gamesCore';

export const GAMES_ADMIN_PATH = '/admin/games';

export const GAMES_ADMIN_TABS = ['games', 'paths', 'categories', 'challenges', 'achievements', 'levels', 'players'];

/** رموز الأخطاء التي ترفعها دوال/مشغّلات 0052 (نص الاستثناء نفسه) + رموز تحقق الواجهة. */
export const GAMES_ADMIN_ERROR_CODES = [
  ...GAMES_ERROR_CODES,
  'slug_taken',
  'invalid_data',
  'solution_required',
  'game_not_found',
  'challenge_not_found',
  'invalid_criteria',
  'level_zero_required',
  'invalid_kind',
  'unsupported_verify_mode',
  'history_locked',
  // 0055/0056: مسارات التعلم
  'stage_has_grants',
  'stage_not_found',
  'stage_not_manual',
  'stage_unlock_not_manual',
  'stage_chain_invalid',
  'stage_not_available',
  'stage_locked',
  'stage_archived',
  'stage_game_mismatch',
  'grant_not_found',
  // 0057: محرر التحديات
  'invalid_language',
  'invalid_content',
  'invalid_challenge_type',
  'invalid_solution',
  'invalid_feedback',
  'invalid_options_count',
  'invalid_item_id',
  'empty_item',
  'duplicate_item',
  'invalid_markers',
  'order_not_shuffled',
  'translation_required',
  'version_not_found',
  'version_not_draft',
  'version_locked',
  'version_in_use',
  'version_status_locked',
  'invalid_version_transition',
  'version_pointer_locked',
  'challenge_versioned',
  'challenge_has_attempts',
  'legacy_title_unsupported',
  'builder_unavailable',
  // رموز محلية (الواجهة)
  'invalid_json',
  'content_has_answer',
  'duplicate_value',
  'invalid_reference',
];

export const ITEM_STATUSES = ['draft', 'published', 'archived'];
export const DIFFICULTIES = [1, 2, 3, 4, 5];

/** أنواع التحقق المدعومة فعليًا في الخادم الآن (exact فقط؛ external محجوز ويُرفض عند التسليم). */
export const VERIFY_MODES = ['exact'];

/** شروط الإنجاز المدعومة في game_grant_achievements (0050). */
export const ACHIEVEMENT_CRITERIA = ['points_total', 'challenges_solved'];

export const LANGS = ['ar', 'fr', 'en'];

/** مسارات التعلم (0055): سياسة فتح مراحل الفئة، وشرط إكمال المرحلة (والعتبة لوضعين فقط). */
export const STAGE_UNLOCK_MODES = ['sequential', 'free', 'manual'];
export const STAGE_COMPLETION_MODES = ['all_required', 'min_success_rate', 'min_points', 'manual'];
export const THRESHOLD_RANGE = { min_success_rate: [1, 100], min_points: [1, 1000000] };
export const GRANT_KINDS = ['unlock', 'complete'];

export const PLAYERS_PAGE_SIZE = 25;
export const POINTS_MAX_DELTA = 100000;
export const ADJUST_NOTE_MAX = 500;

/** مفاتيح محظورة في content العلني (إجابة/حل). الحلّ مكانه الوحيد جدول الحلول. */
export const CONTENT_FORBIDDEN_KEY = /^(solutions?|answers?|correct(_?\w*)?|expected(_?\w*)?)$/i;
