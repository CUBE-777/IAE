// supabase/functions/notify-member-card-request/index.ts
//
// يُرسل بريدًا للعضو بعد أن يعتمد المسؤول طلب تعديل بطاقته أو يرفضه (0036/0045).
//
// الأمان:
//   - الهوية: auth.getUser(token) ثم rpc can_manage_member_system بصلاحية المستدعي (نفس أدوار نظام الأعضاء).
//   - عنوان البريد لا يأتي من العميل أبدًا: يُقرأ من سجل العضو في القاعدة بـ service_role.
//   - لا يُرسل إلا لطلب بحالة approved/rejected رُوجع خلال آخر 30 دقيقة ولم يُشعَر بعد (notified_at)؛
//     فلا تصلح الدالة لإغراق بريد أي عضو برسائل متكررة.
//   - عند غياب الإعداد (RESEND_API_KEY / MAIL_FROM) تُرجع { sent:false, reason:'not_configured' } دون أي فشل في الواجهة.
//
// الإعداد (مرة واحدة):
//   supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="النادي <noreply@your-domain.org>"
//   اختياري: SITE_URL=https://fsa-iae.netlify.app  (رابط فضاء العضو داخل الرسالة)
// النشر:  supabase functions deploy notify-member-card-request --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';

const DEFAULT_ORIGINS = ['https://fsa-iae.netlify.app', 'http://localhost:5173', 'http://localhost:4173'];
const PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+--fsa-iae\.netlify\.app$/;
const FRESH_MS = 30 * 60 * 1000;

function corsFor(req: Request): Record<string, string> {
  const extra = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  const ok = origin !== '' && ([...DEFAULT_ORIGINS, ...extra].includes(origin) || PREVIEW_ORIGIN_RE.test(origin));
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildMail(status: 'approved' | 'rejected', name: string, note: string, spaceUrl: string) {
  const approved = status === 'approved';
  const subject = approved
    ? 'تم اعتماد تعديل بطاقتك — Votre fiche a été validée — Your card update was approved'
    : 'تعذّر اعتماد تعديل بطاقتك — Modification non validée — Card update not approved';

  const ar = approved
    ? 'اعتمدت الإدارة التعديلات التي اقترحتها على بطاقتك، وهي ظاهرة الآن في الموقع.'
    : 'لم تعتمد الإدارة التعديلات التي اقترحتها على بطاقتك. يمكنك مراجعتها وإرسال طلب جديد من فضاء العضو.';
  const fr = approved
    ? 'Vos modifications ont été validées et sont maintenant visibles sur le site.'
    : 'Vos modifications n’ont pas été validées. Vous pouvez les revoir et envoyer une nouvelle demande depuis votre espace membre.';
  const en = approved
    ? 'Your changes were approved and are now live on the site.'
    : 'Your changes were not approved. You can review them and send a new request from your member space.';

  const noteHtml = !approved && note
    ? `<p dir="auto" style="background:#f6f6f6;border-radius:8px;padding:10px 12px"><strong>ملاحظة الإدارة / Note :</strong><br>${esc(note)}</p>`
    : '';
  const link = spaceUrl ? `<p><a href="${esc(spaceUrl)}">${esc(spaceUrl)}</a></p>` : '';

  const html = `<div style="font-family:Arial,sans-serif;line-height:1.7;max-width:560px">
<p dir="rtl">مرحبًا ${esc(name)}،</p><p dir="rtl">${ar}</p>
<hr style="border:none;border-top:1px solid #ddd">
<p>${fr}</p><p>${en}</p>${noteHtml}${link}</div>`;
  const text = `مرحبًا ${name}،\n${ar}\n\n${fr}\n${en}\n${!approved && note ? `\nNote: ${note}\n` : ''}${spaceUrl ? `\n${spaceUrl}\n` : ''}`;
  return { subject, html, text };
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'مطلوب تسجيل الدخول' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authClient = createClient(url, anon);
    const { data: u, error: uErr } = await authClient.auth.getUser(token);
    if (uErr || !u?.user) return json({ error: 'جلسة غير صالحة' }, 401);

    // صلاحية المستدعي تُقيَّم في القاعدة بهويته هو (auth.uid())
    const callerClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: allowed, error: roleErr } = await callerClient.rpc('can_manage_member_system');
    if (roleErr || allowed !== true) return json({ error: 'غير مصرّح لك بهذه العملية' }, 403);

    const body = await req.json().catch(() => ({}));
    const requestId = typeof body?.request_id === 'string' ? body.request_id : '';
    if (!UUID_RE.test(requestId)) return json({ error: 'طلب غير صالح' }, 400);

    const apiKey = Deno.env.get('RESEND_API_KEY') || '';
    const from = Deno.env.get('MAIL_FROM') || '';
    if (!apiKey || !from) return json({ sent: false, reason: 'not_configured' });

    const admin = createClient(url, service);
    const { data: r, error: rErr } = await admin
      .from('member_card_requests')
      .select('id, status, review_note, reviewed_at, notified_at, members(full_name, email)')
      .eq('id', requestId)
      .maybeSingle();
    if (rErr || !r) return json({ sent: false, reason: 'not_found' });

    const member = Array.isArray(r.members) ? r.members[0] : r.members;
    if (r.status !== 'approved' && r.status !== 'rejected') return json({ sent: false, reason: 'not_reviewed' });
    if (r.notified_at) return json({ sent: false, reason: 'already_notified' });
    if (!r.reviewed_at || Date.now() - new Date(r.reviewed_at).getTime() > FRESH_MS) return json({ sent: false, reason: 'stale' });
    const email = String(member?.email || '').trim();
    if (!email) return json({ sent: false, reason: 'no_email' });

    // نحجز الإشعار ذريًا قبل الإرسال (يمنع إرسالين متزامنين)، ونُرجعه عند فشل الإرسال
    const { data: claimed } = await admin
      .from('member_card_requests')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('notified_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) return json({ sent: false, reason: 'already_notified' });

    const site = (Deno.env.get('SITE_URL') || '').replace(/\/+$/, '');
    const mail = buildMail(r.status, String(member?.full_name || ''), String(r.review_note || ''), site ? `${site}/member` : '');

    let ok = false;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      ok = res.ok;
      if (!ok) console.error('resend failed', res.status);
    } catch (e) {
      console.error('resend error', e instanceof Error ? e.message : 'unknown');
    }

    if (!ok) {
      await admin.from('member_card_requests').update({ notified_at: null }).eq('id', requestId);
      return json({ sent: false, reason: 'send_failed' });
    }
    return json({ sent: true });
  } catch (e) {
    console.error('notify-member-card-request', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'تعذّر تنفيذ العملية' }, 500);
  }
}

Deno.serve(async (req) => {
  const res = await handle(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsFor(req))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});
