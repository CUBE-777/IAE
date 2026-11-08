import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_TOKEN_TTL_MS, CARD_REFRESH_MS, classifyIssueError, secondsLeft, shouldRefreshOnReturn,
  verifyUrl, membershipState, verifyState,
} from '../src/utils/memberCardToken.js';

test('رمز البطاقة: التجديد (90ث) يسبق انتهاء الصلاحية (120ث) بهامش، ويطابق 0040', () => {
  assert.equal(CARD_TOKEN_TTL_MS, 120_000);
  assert.equal(CARD_REFRESH_MS, 90_000);
  assert.ok(CARD_REFRESH_MS < CARD_TOKEN_TTL_MS);
});

test('classifyIssueError: rate_limited وغير مصرّح وغيرها', () => {
  assert.equal(classifyIssueError({ message: 'rate_limited' }), 'rate_limited');
  assert.equal(classifyIssueError({ message: 'Something RATE_LIMITED here' }), 'rate_limited');
  assert.equal(classifyIssueError({ message: 'غير مصرّح لك بهذه العملية' }), 'forbidden');
  assert.equal(classifyIssueError({ message: 'permission denied for function issue_member_card_token' }), 'forbidden');
  assert.equal(classifyIssueError({ message: 'Failed to fetch' }), 'error');
  assert.equal(classifyIssueError(new TypeError('NetworkError')), 'error');
  assert.equal(classifyIssueError(null), 'error');
  assert.equal(classifyIssueError(undefined), 'error');
});

test('secondsLeft: تقريب لأعلى ولا تقل عن صفر ولا شيء بلا رمز', () => {
  assert.equal(secondsLeft(10_000, 0), 10);
  assert.equal(secondsLeft(10_000, 9_001), 1);
  assert.equal(secondsLeft(10_000, 10_000), 0);
  assert.equal(secondsLeft(10_000, 50_000), 0);
  assert.equal(secondsLeft(0, 5), 0);
  assert.equal(secondsLeft(null, 5), 0);
});

test('shouldRefreshOnReturn: لا رمز أو حان التجديد → نعم، وإلا لا', () => {
  assert.equal(shouldRefreshOnReturn(null, 1), true);
  const t = { value: 'x', expiresAt: 120_000, refreshAt: 90_000 };
  assert.equal(shouldRefreshOnReturn(t, 89_999), false);
  assert.equal(shouldRefreshOnReturn(t, 90_000), true);
  assert.equal(shouldRefreshOnReturn(t, 500_000), true);
});

test('verifyUrl: أصل + /verify/ + الرمز، بلا شرطة مزدوجة وبلا بيانات شخصية', () => {
  assert.equal(verifyUrl('https://x.org', 'T0k-_'), 'https://x.org/verify/T0k-_');
  assert.equal(verifyUrl('https://x.org/', 'T'), 'https://x.org/verify/T');
});

test('membershipState: الحالات الأربع للعضو', () => {
  assert.equal(membershipState(undefined), 'unset');
  assert.equal(membershipState(null), 'unset');
  assert.equal(membershipState({ season: null, active: null, paid_at: null, has_previous: false }), 'unset');
  assert.equal(membershipState({ season: '2026-2027', active: true }), 'active');
  assert.equal(membershipState({ season: '2026-2027', active: false, has_previous: true }), 'lapsed');
  assert.equal(membershipState({ season: '2026-2027', active: false, has_previous: false }), 'none');
  assert.equal(membershipState({ season: '2026-2027', active: false }), 'none');
});

test('verifyState: أخضر/برتقالي/أحمر — المجهول والمنتهي والشكل الغريب كلها invalid', () => {
  assert.equal(verifyState({ valid: false }), 'invalid');
  assert.equal(verifyState(null), 'invalid');
  assert.equal(verifyState({}), 'invalid');
  assert.equal(verifyState({ valid: 'true' }), 'invalid');
  assert.equal(verifyState({ valid: true, membership: { season: '2026-2027', active: true } }), 'active');
  assert.equal(verifyState({ valid: true, membership: { season: '2026-2027', active: false } }), 'inactive');
  assert.equal(verifyState({ valid: true, membership: { season: null, active: null } }), 'unknown');
  assert.equal(verifyState({ valid: true }), 'unknown');
});
