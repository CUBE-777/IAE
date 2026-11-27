import './helpers/esm-mocks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const W = '../supabase/functions/certificate-email-worker';
const core = await import(`${W}/core.ts`);
const tpl = await import(`${W}/template.ts`);
const { runWorker, makeResendSender, secretsMatch, clampMaxJobs, newWorkerId, WORKER_ID_RE, HARD_MAX_JOBS } = core;

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SITE = 'https://fsa-iae.netlify.app';
const tokenFor = (i) => `Tok${String(i).padStart(3, '0')}`.padEnd(43, 'x');
const SECRETS = (i) => ({ token: tokenFor(i), email: `person${i}@example.org`, name: `Secret Person ${i}`, number: `IAE-2026-${String(i).padStart(6, '0')}` });

/** محاكي قاعدة البيانات لدوال العامل (نفس عقود 0065/0066: claim يحجز، recheck يشترط الحاجز والصلاحية، complete يشترط الحاجز). */
function makeSim(n, { onClaim } = {}) {
  const q = Array.from({ length: n }, (_, k) => ({ i: k + 1, id: `00000000-0000-4000-8000-${String(k + 1).padStart(12, '0')}`, status: 'queued', claimedBy: null, attempts: 0, revoked: false }));
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    const find = () => q.find((x) => x.id === args.p_queue_id);
    if (fn === 'certificate_email_release_stale') return { data: 0, error: null };
    if (fn === 'certificate_email_claim_next') {
      const j = q.find((x) => x.status === 'queued' && !x.revoked && !x.deferred); // deferred = next_attempt_at في المستقبل (backoff attempts² دقيقة)
      if (!j) return { data: null, error: null };
      j.status = 'sending'; j.claimedBy = args.p_worker; j.attempts += 1;
      onClaim?.(j);
      const s = SECRETS(j.i);
      return { data: { queue_id: j.id, certificate_id: j.id, attempt: j.attempts, to_email: s.email, recipient_name: s.name, certificate_number: s.number, certificate_type: 'training', language: j.i % 3 === 0 ? 'ar' : 'fr', campaign_title: 'Atelier IA', token: s.token }, error: null };
    }
    if (fn === 'certificate_email_recheck') {
      const j = find();
      return { data: !!j && j.status === 'sending' && j.claimedBy === args.p_worker && !j.revoked, error: null };
    }
    if (fn === 'certificate_email_complete') {
      const j = find();
      if (!j || j.status !== 'sending') return { data: null, error: { code: '22023' } };
      if (j.claimedBy !== args.p_worker) return { data: null, error: { code: '42501' } };
      if (args.p_success) j.status = 'sent';
      else if (j.revoked) j.status = 'cancelled';
      else { j.status = 'queued'; j.claimedBy = null; j.deferred = true; }
      return { data: j.status, error: null };
    }
    throw new Error(`rpc غير متوقع: ${fn}`);
  };
  return { q, calls, rpc, count: (fn) => calls.filter((c) => c.fn === fn).length, of: (fn) => calls.filter((c) => c.fn === fn) };
}
const okMail = () => { const sent = []; return { sent, sendMail: async (m) => { sent.push(m); return { ok: true }; } }; };
const base = (sim, mail, extra = {}) => ({ rpc: sim.rpc, sendMail: mail.sendMail, siteOrigin: SITE, workerId: 'cew:abc123', minSendIntervalMs: 0, sleep: async () => {}, ...extra });

// ------------------------------------------------------------------ نجاح / فشل Resend
test('العامل: نجاح Resend → complete(true) والمهمة sent', async () => {
  const sim = makeSim(1); const mail = okMail();
  const s = await runWorker(base(sim, mail));
  assert.equal(mail.sent.length, 1);
  const done = sim.of('certificate_email_complete');
  assert.equal(done.length, 1);
  assert.deepEqual(done[0].args, { p_queue_id: sim.q[0].id, p_worker: 'cew:abc123', p_success: true, p_error_code: null });
  assert.equal(sim.q[0].status, 'sent');
  assert.equal(s.sent, 1);
});

test('العامل: فشل Resend → complete(false, رمز ثابت) ولا تُعلَّم المهمة sent', async () => {
  const sim = makeSim(1);
  const s = await runWorker(base(sim, { sendMail: async () => ({ ok: false, code: 'resend_http_500' }) }));
  const done = sim.of('certificate_email_complete');
  assert.equal(done.length, 1);
  assert.equal(done[0].args.p_success, false);
  assert.equal(done[0].args.p_error_code, 'resend_http_500');
  assert.notEqual(sim.q[0].status, 'sent');
  assert.equal(s.sent, 0);
  assert.equal(s.retried, 1);
});

test('العامل: استثناء من مُرسِل البريد يُعامل فشلًا (complete(false)) لا انهيارًا', async () => {
  const sim = makeSim(2);
  let n = 0;
  const s = await runWorker(base(sim, { sendMail: async () => { n++; if (n === 1) throw new Error('boom'); return { ok: true }; } }));
  assert.equal(sim.of('certificate_email_complete')[0].args.p_error_code, 'send_exception');
  assert.equal(s.sent, 1);
});

test('العامل: رموز الخطأ المرسلة للقاعدة تطابق قيد CHECK (^[a-z0-9_]{1,40}$)', async () => {
  const codes = [];
  for (const [status, code] of [[400, 'resend_http_400'], [422, 'resend_http_422'], [500, 'resend_http_500'], [429, 'resend_rate_limited']]) {
    const send = makeResendSender(async () => new Response('{"message":"leak a@b.co"}', { status }), 're_secret', 'IAE <n@x.org>');
    const r = await send({ to: 'a@b.co', subject: 's', html: 'h', text: 't' });
    assert.deepEqual(r, { ok: false, code });
    codes.push(r.code);
  }
  const net = await makeResendSender(async () => { throw new TypeError('fetch failed re_secret'); }, 're_secret', 'f')({ to: 'a@b.co', subject: 's', html: 'h', text: 't' });
  codes.push(net.code);
  assert.equal(net.code, 'resend_network');
  for (const c of codes) assert.match(c, /^[a-z0-9_]{1,40}$/);
});

test('Resend: الطلب JSON بلا مرفقات، المفتاح في الترويسة فقط، والمهلة تُنتج resend_timeout', async () => {
  let seen;
  const send = makeResendSender(async (url, init) => { seen = { url, init }; return new Response('{}', { status: 200 }); }, 're_KEY', 'IAE <n@x.org>');
  const r = await send({ to: 'to@example.org', subject: 'Subj', html: '<p>h</p>', text: 't' });
  assert.deepEqual(r, { ok: true });
  assert.equal(seen.url, 'https://api.resend.com/emails');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer re_KEY');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'subject', 'text', 'to']);
  assert.deepEqual(body.to, ['to@example.org']);
  assert.ok(!('attachments' in body));
  assert.ok(!seen.init.body.includes('re_KEY'));

  const slow = makeResendSender((url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))), 'k', 'f', 20);
  assert.deepEqual(await slow({ to: 'a@b.co', subject: 's', html: 'h', text: 't' }), { ok: false, code: 'resend_timeout' });
});

// ------------------------------------------------------------------ الشهادة الملغاة
test('العامل: الشهادة الملغاة بعد الحجز → recheck=false → لا يُرسَل بريد وتُلغى المهمة', async () => {
  const sim = makeSim(1, { onClaim: (j) => { j.revoked = true; } }); // أُلغيت بين claim وrecheck
  const mail = okMail();
  const s = await runWorker(base(sim, mail));
  assert.equal(mail.sent.length, 0, 'أُرسل بريد لشهادة ملغاة');
  assert.equal(sim.count('certificate_email_recheck'), 1);
  const done = sim.of('certificate_email_complete');
  assert.equal(done.length, 1);
  assert.equal(done[0].args.p_success, false);
  assert.equal(sim.q[0].status, 'cancelled');
  assert.equal(s.cancelled, 1);
  assert.equal(s.skipped, 1);
});

test('العامل: recheck يسبق الإرسال دائمًا ويحمل هوية الحاجز نفسها', async () => {
  const sim = makeSim(3); const order = [];
  const mail = { sendMail: async () => { order.push('send'); return { ok: true }; } };
  const rpc = async (fn, args) => { if (fn === 'certificate_email_recheck') order.push('recheck'); return sim.rpc(fn, args); };
  await runWorker({ ...base(sim, mail), rpc, workerId: 'cew:feed01' });
  assert.deepEqual(order, ['recheck', 'send', 'recheck', 'send', 'recheck', 'send']);
  const ids = new Set([...sim.of('certificate_email_claim_next'), ...sim.of('certificate_email_recheck'), ...sim.of('certificate_email_complete')].map((c) => c.args.p_worker));
  assert.deepEqual([...ids], ['cew:feed01']);
});

test('العامل: خطأ قاعدة في recheck → لا إرسال', async () => {
  const sim = makeSim(1); const mail = okMail();
  const rpc = async (fn, args) => (fn === 'certificate_email_recheck' ? { data: null, error: { code: '57014' } } : sim.rpc(fn, args));
  await runWorker({ ...base(sim, mail), rpc });
  assert.equal(mail.sent.length, 0);
  assert.equal(sim.of('certificate_email_complete')[0].args.p_error_code, 'recheck_error');
});

test('العامل: عامل آخر لا يستطيع إكمال مهمتنا (حارس الهوية) ولا يُعاد الإرسال عند فشل complete', async () => {
  const sim = makeSim(1); const mail = okMail();
  // complete يفشل بعد نجاح الإرسال: لا إعادة إرسال تلقائية
  const rpc = async (fn, args) => (fn === 'certificate_email_complete' ? { data: null, error: { code: '42501' } } : sim.rpc(fn, args));
  const s = await runWorker({ ...base(sim, mail), rpc });
  assert.equal(mail.sent.length, 1);
  assert.equal(s.errors, 1);
  assert.equal(s.sent, 0);
  // المحاكي نفسه يرفض هوية مختلفة
  const other = await sim.rpc('certificate_email_complete', { p_queue_id: sim.q[0].id, p_worker: 'cew:other', p_success: true, p_error_code: null });
  assert.equal(other.error.code, '42501');
});

test('العامل: حمولة مهمة مشوّهة لا تُرسل؛ تُكمَّل بـ invalid_job إن عُرف queue_id', async () => {
  const id = '00000000-0000-4000-8000-000000000009';
  const calls = [];
  let given = false;
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'certificate_email_claim_next') { if (given) return { data: null, error: null }; given = true; return { data: { queue_id: id, to_email: 'not-an-email', token: 'short' }, error: null }; }
    if (fn === 'certificate_email_complete') return { data: 'queued', error: null };
    return { data: 0, error: null };
  };
  const mail = okMail();
  const s = await runWorker({ rpc, sendMail: mail.sendMail, siteOrigin: SITE, workerId: 'cew:a', minSendIntervalMs: 0 });
  assert.equal(mail.sent.length, 0);
  const done = calls.find((c) => c.fn === 'certificate_email_complete');
  assert.equal(done.args.p_error_code, 'invalid_job');
  assert.equal(s.skipped, 1);
});

test('العامل: release_stale أولًا بـ 15 دقيقة، وخطأ claim يوقف التشغيل بلا إرسال', async () => {
  const sim = makeSim(2); const mail = okMail();
  const rpc = async (fn, args) => (fn === 'certificate_email_claim_next' ? { data: null, error: { code: '57P01' } } : sim.rpc(fn, args));
  const s = await runWorker({ ...base(sim, mail), rpc });
  assert.equal(sim.calls[0].fn, 'certificate_email_release_stale');
  assert.deepEqual(sim.calls[0].args, { p_older_than_minutes: 15 });
  assert.equal(s.stopped, 'claim_error');
  assert.equal(mail.sent.length, 0);
});

// ------------------------------------------------------------------ الحدود
test('العامل: يعالج عدة مهام ويتوقف عند maxJobs (لا يستنزف الطابور)', async () => {
  const sim = makeSim(50); const mail = okMail();
  const s = await runWorker({ ...base(sim, mail), maxJobs: 10 });
  assert.equal(mail.sent.length, 10);
  assert.equal(s.stopped, 'max_jobs');
  assert.equal(sim.q.filter((x) => x.status === 'queued').length, 40);
  assert.equal(sim.count('certificate_email_claim_next'), 10);
});

test('العامل: الطابور الفارغ → stopped=empty، وسقف maxJobs صلب (≤ 25) ولو طُلب أكثر', async () => {
  const sim = makeSim(0);
  assert.equal((await runWorker(base(sim, okMail()))).stopped, 'empty');
  assert.equal(clampMaxJobs(10_000), HARD_MAX_JOBS);
  assert.equal(clampMaxJobs(0), 1);
  assert.equal(clampMaxJobs(-5), 1);
  assert.equal(clampMaxJobs('9'), 10);
  const big = makeSim(100); const mail = okMail();
  await runWorker({ ...base(big, mail), maxJobs: 10_000 });
  assert.equal(mail.sent.length, HARD_MAX_JOBS);
});

test('العامل: الميزانية الزمنية — يتوقف قبل تجاوز المهلة ولا يبدأ مهمة لا يتّسع وقتها', async () => {
  const sim = makeSim(20);
  let clock = 0;
  const mail = { sendMail: async () => { clock += 12_000; return { ok: true }; } }; // كل إرسال 12 ثانية
  const s = await runWorker({ ...base(sim, mail), now: () => clock, timeBudgetMs: 50_000, sendTimeoutMs: 10_000, maxJobs: 20 });
  assert.equal(s.stopped, 'time_budget');
  assert.ok(s.sent >= 1 && s.sent < 20, `sent=${s.sent}`);
  assert.ok(clock <= 50_000, `تجاوز الميزانية: ${clock}`);
});

test('العامل: وتيرة الإرسال — ينام بين الرسائل ويتوقف فور 429 دون استنزاف المحاولات', async () => {
  const sim = makeSim(5); const sleeps = [];
  let clock = 0;
  const mail = { sendMail: async () => { clock += 100; return { ok: true }; } };
  await runWorker({ ...base(sim, mail), now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, minSendIntervalMs: 600, maxJobs: 3 });
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every((ms) => ms > 0 && ms <= 600));

  const sim2 = makeSim(5);
  const s = await runWorker(base(sim2, { sendMail: async () => ({ ok: false, code: 'resend_rate_limited' }) }));
  assert.equal(s.stopped, 'rate_limited');
  assert.equal(sim2.count('certificate_email_claim_next'), 1);
  assert.equal(sim2.of('certificate_email_complete')[0].args.p_error_code, 'resend_rate_limited');
});

test('العامل: هوية فريدة بصيغة تقبلها القاعدة', () => {
  const a = newWorkerId(); const b = newWorkerId();
  assert.match(a, WORKER_ID_RE);
  assert.notEqual(a, b);
});

// ------------------------------------------------------------------ الخصوصية في السجلات والاستجابة
test('العامل: لا tokens ولا بريد ولا اسم ولا رقم شهادة في السجلات أو الملخّص أو console', async () => {
  const sim = makeSim(4);
  const logged = [];
  const orig = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { orig[k] = console[k]; console[k] = (...a) => logged.push(a.map(String).join(' ')); }
  let summary;
  try {
    let n = 0;
    summary = await runWorker({ ...base(sim, { sendMail: async () => { n++; return n === 2 ? { ok: false, code: 'resend_http_500' } : { ok: true }; } }), log: (e, f) => logged.push(JSON.stringify({ e, ...f })) });
  } finally { for (const k of Object.keys(orig)) console[k] = orig[k]; }
  const blob = `${logged.join('\n')}\n${JSON.stringify(summary)}`;
  assert.ok(logged.length > 0, 'يجب أن يوجد سجل ما');
  for (let i = 1; i <= 4; i++) {
    const s = SECRETS(i);
    for (const v of [s.token, s.email, s.name, s.number, 'Atelier IA']) assert.ok(!blob.includes(v), `تسرّب: ${v}`);
  }
  assert.ok(!blob.includes('verify-certificate'));
});

// ------------------------------------------------------------------ البريد: المحتوى
test('البريد: رابط التحقق وليس PDF، بلا مرفقات، والفرنسية افتراضية', async () => {
  const sim = makeSim(1); const mail = okMail();
  await runWorker(base(sim, mail));
  const m = mail.sent[0];
  const s = SECRETS(1);
  assert.equal(m.to, s.email);
  assert.ok(m.html.includes(`${SITE}/verify-certificate/${s.token}`));
  assert.ok(m.text.includes(`${SITE}/verify-certificate/${s.token}`));
  assert.ok(m.html.includes(s.name) && m.html.includes(s.number) && m.html.includes('Atelier IA'));
  assert.match(m.html, /<html lang="fr" dir="ltr">/);
  assert.ok(!('attachments' in m));
  assert.doesNotMatch(m.html, /\.pdf|application\/pdf|attachment/i);
  assert.ok(!m.subject.includes(s.name), 'الاسم في العنوان');
});

test('البريد: العربية RTL والإنجليزية، ولغة مجهولة → فرنسية', () => {
  const input = { recipientName: 'Sara', certificateNumber: 'IAE-2026-000001', certificateType: 'training', campaignTitle: 'T', verifyUrl: `${SITE}/verify-certificate/${tokenFor(1)}` };
  const ar = tpl.buildCertificateEmail({ ...input, language: 'ar' });
  assert.match(ar.html, /<html lang="ar" dir="rtl">/);
  assert.match(ar.html, /تكوين/);
  assert.match(tpl.buildCertificateEmail({ ...input, language: 'en' }).html, /Verify my certificate/);
  const fr = tpl.buildCertificateEmail({ ...input, language: 'xx' });
  assert.match(fr.html, /Vérifier mon certificat/);
  assert.match(fr.subject, /Votre certificat IAE/);
});

test('البريد: تهريب HTML في الاسم والعنوان (لا حقن)', () => {
  const m = tpl.buildCertificateEmail({ language: 'fr', recipientName: '<img src=x onerror=alert(1)>', certificateNumber: 'IAE-2026-000001', certificateType: 'training', campaignTitle: '"><script>x()</script>', verifyUrl: `${SITE}/verify-certificate/${tokenFor(1)}` });
  assert.ok(!m.html.includes('<img src=x'));
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('البريد: SITE_URL يُقبل https فقط (أو localhost) ويُختزل إلى origin، والرمز المشوّه يُرفض', () => {
  assert.equal(tpl.normalizeSiteUrl('https://fsa-iae.netlify.app/some/path?x=1'), 'https://fsa-iae.netlify.app');
  assert.equal(tpl.normalizeSiteUrl('http://localhost:5173'), 'http://localhost:5173');
  for (const bad of ['http://evil.example', 'javascript:alert(1)', '', undefined, 'not a url', 'ftp://x.org']) assert.equal(tpl.normalizeSiteUrl(bad), null, String(bad));
  assert.equal(tpl.buildVerifyUrl(SITE, 'short'), null);
  assert.equal(tpl.buildVerifyUrl(SITE, `${'a'.repeat(42)}/`), null);
  assert.equal(tpl.buildVerifyUrl(SITE, tokenFor(1)), `${SITE}/verify-certificate/${tokenFor(1)}`);
});

// ------------------------------------------------------------------ نقطة الدخول (index.ts) مع Deno وهمي
const SECRET = 's'.repeat(40);
const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API_KEY: 're_test', MAIL_FROM: 'IAE <noreply@x.org>', SITE_URL: SITE, CERTIFICATE_EMAIL_WORKER_SECRET: SECRET };
let env = { ...ENV };
let handler;
const clients = [];
let sim;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
globalThis.__createClientMock = (url, key, opts) => { clients.push({ url, key, opts }); return { rpc: async (fn, args) => sim.rpc(fn, args) }; };
await import(`${W}/index.ts`);
const call = (headers = {}, { method = 'POST', body = '{}' } = {}) => handler(new Request('https://fn.local/', { method, headers, body: method === 'GET' ? undefined : body }));

test('index: بلا secret صحيح لا يُنشأ عميل ولا يُحجز شيء ولا يُرسل بريد', async () => {
  sim = makeSim(3);
  const realFetch = globalThis.fetch; let fetched = 0;
  globalThis.fetch = async () => { fetched++; return new Response('{}', { status: 200 }); };
  try {
    for (const headers of [{}, { 'x-worker-secret': '' }, { 'x-worker-secret': 'wrong'.repeat(10) }, { 'x-worker-secret': SECRET.slice(0, -1) }, { authorization: `Bearer ${SECRET}` }]) {
      const res = await call(headers);
      assert.equal(res.status, 401, JSON.stringify(headers));
    }
  } finally { globalThis.fetch = realFetch; }
  assert.equal(clients.length, 0, 'أُنشئ عميل service_role قبل التحقق من السرّ');
  assert.equal(sim.calls.length, 0);
  assert.equal(fetched, 0);
});

test('index: POST فقط، وسرّ ناقص/قصير في الإعداد → 503 بلا حجز', async () => {
  sim = makeSim(1);
  assert.equal((await call({ 'x-worker-secret': SECRET }, { method: 'GET' })).status, 405);
  for (const patch of [{ CERTIFICATE_EMAIL_WORKER_SECRET: '' }, { CERTIFICATE_EMAIL_WORKER_SECRET: 'short' }]) {
    env = { ...ENV, ...patch };
    const res = await call({ 'x-worker-secret': patch.CERTIFICATE_EMAIL_WORKER_SECRET });
    assert.equal(res.status, 503);
  }
  for (const missing of ['RESEND_API_KEY', 'MAIL_FROM', 'SITE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']) {
    env = { ...ENV, [missing]: '' };
    assert.equal((await call({ 'x-worker-secret': SECRET })).status, 503, missing);
  }
  env = { ...ENV, SITE_URL: 'http://insecure.example' };
  assert.equal((await call({ 'x-worker-secret': SECRET })).status, 503);
  env = { ...ENV };
  assert.equal(sim.calls.length, 0, 'حُجزت مهمة رغم نقص الإعداد');
  assert.equal(clients.length, 0);
});

test('index: بالسرّ الصحيح يعالج المهام عبر service_role ويُرجع أعدادًا فقط (نجاح Resend → complete(true))', async () => {
  sim = makeSim(3); clients.length = 0;
  const realFetch = globalThis.fetch; const sentTo = [];
  globalThis.fetch = async (url, init) => { sentTo.push({ url, body: JSON.parse(init.body) }); return new Response('{"id":"x"}', { status: 200 }); };
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  let res; let text;
  try { res = await call({ 'x-worker-secret': SECRET }, { body: JSON.stringify({ max_jobs: 2 }) }); text = await res.text(); } finally { globalThis.fetch = realFetch; console.log = orig; }
  assert.equal(res.status, 200);
  const out = JSON.parse(text);
  assert.equal(out.ok, true);
  assert.equal(out.sent, 2);
  assert.equal(out.stopped, 'max_jobs');
  assert.equal(sentTo.length, 2);
  assert.ok(sentTo.every((m) => m.url === 'https://api.resend.com/emails' && !('attachments' in m.body)));
  assert.equal(clients.length, 1);
  assert.equal(clients[0].key, 'service-key');
  assert.equal(clients[0].opts.auth.persistSession, false);
  assert.ok(sim.of('certificate_email_complete').every((c) => c.args.p_success === true));
  assert.match(res.headers.get('cache-control'), /no-store/);
  const blob = `${text}\n${logs.join('\n')}`;
  for (const i of [1, 2, 3]) { const s = SECRETS(i); for (const v of [s.token, s.email, s.name, s.number, SECRET, 're_test', 'service-key']) assert.ok(!blob.includes(v), `تسرّب ${v}`); }
});

test('index: فشل Resend عبر المعالج → complete(false) بلا إخفاق الطلب', async () => {
  sim = makeSim(1);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"message":"bad"}', { status: 422 });
  let res;
  try { res = await call({ 'x-worker-secret': SECRET }); } finally { globalThis.fetch = realFetch; }
  assert.equal(res.status, 200);
  const done = sim.of('certificate_email_complete');
  assert.equal(done.length, 1);
  assert.equal(done[0].args.p_success, false);
  assert.equal(done[0].args.p_error_code, 'resend_http_422');
  assert.equal((await res.json()).retried, 1);
});

test('secretsMatch: مقارنة صحيحة وفارغ مرفوض', async () => {
  assert.equal(await secretsMatch('abc', 'abc'), true);
  assert.equal(await secretsMatch('abc', 'abd'), false);
  assert.equal(await secretsMatch('', ''), false);
  assert.equal(await secretsMatch('abc', ''), false);
});

test('index (ثابت): لا CORS، لا تخزين، المفتاح من Deno.env فقط، والتحقق من السرّ قبل إنشاء العميل', () => {
  const idx = read('supabase/functions/certificate-email-worker/index.ts');
  const code = idx.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /Access-Control|localStorage|sessionStorage/);
  assert.match(code, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
  assert.match(code, /Deno\.env\.get\('CERTIFICATE_EMAIL_WORKER_SECRET'\)/);
  assert.ok(code.indexOf('secretsMatch(') < code.indexOf('createClient('), 'السرّ يُفحص قبل createClient');
  assert.ok(code.indexOf("'method_not_allowed'") < code.indexOf('secretsMatch('));
  assert.doesNotMatch(code, /console\.(log|error|warn)\([^)]*(token|email|secret|key)/i);
  // لا قيم أسرار مكتوبة في الملفات
  for (const f of ['index.ts', 'core.ts', 'template.ts']) assert.doesNotMatch(read(`supabase/functions/certificate-email-worker/${f}`), /re_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{20,}/, f);
});

test('الأسرار: لا يظهر أي اسم سرّ العامل ولا مفتاح service_role ولا RESEND في الواجهة (src)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const root = new URL('../src', import.meta.url).pathname;
  for (const f of walk(root).filter((x) => /\.(jsx?|json|css)$/.test(x))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /CERTIFICATE_EMAIL_WORKER_SECRET|SERVICE_ROLE|RESEND_API_KEY|certificate-email-worker/, f);
  }
});
