import test from 'node:test';
import assert from 'node:assert/strict';
import { translateAuditDescription as t } from '../src/utils/auditDescription.js';

test('وصف السجل: القوالب المعروفة تُترجم والأسماء تبقى كما هي', () => {
  assert.equal(t('حذف النشاط ورشة', 'en'), 'Deleted activity ورشة');
  assert.equal(t('تحديث الإعدادات العامة', 'fr'), 'Mise à jour des paramètres généraux');
  assert.equal(t('تحديث الإعدادات العامة', 'ar'), 'تحديث الإعدادات العامة');
  assert.equal(t('وصف غير معروف', 'fr'), 'وصف غير معروف');
  assert.equal(t(null, 'fr'), null);
});
