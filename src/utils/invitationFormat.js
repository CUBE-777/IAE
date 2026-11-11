export const TZ = 'Africa/Casablanca';

export const DEFAULT_SETTINGS = {
  starts_local: '',
  headline_1: 'CÉRÉMONIE',
  headline_2: 'D’ACCUEIL',
  intro_text: 'Vous êtes cordialement invité{e} à la',
  subtitle_text: 'du club Intelligence Artificielle Embarquée',
  venue_text: '',
  thanks_text: 'Votre présence est un honneur pour nous',
  allow_download: true,
};

/** {e} → «e» للضيفة (féminin) وفراغ للضيف. */
export const introFor = (text, gender) => String(text || '').replace(/\{e\}/g, gender === 'f' ? 'e' : '');

export const inviteUrl = (token) => `${window.location.origin}/invite/${token}`;

export function dateLabel(iso) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(iso)).toUpperCase();
}

export function timeLabel(iso) {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g('hour')}h${g('minute')}`;
}

function tzOffsetMs(utcMs) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** 'YYYY-MM-DDTHH:mm' بتوقيت الدار البيضاء → ISO (للمعاينة فقط؛ القاعدة تحوّل بنفسها عند الحفظ). */
export function localToIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = naive - tzOffsetMs(naive);
  t = naive - tzOffsetMs(t);
  return new Date(t).toISOString();
}

/** تخمين أولي من تاريخ النشاط ونص وقته الحر (مثل 13h00 أو 13:30). */
export function guessStartsLocal(activity) {
  const d = String(activity?.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const m = /(\d{1,2})\s*(?:h|H|:)\s*(\d{2})?/.exec(activity?.time || '');
  const hh = m ? String(Math.min(+m[1], 23)).padStart(2, '0') : '10';
  const mm = m && m[2] ? m[2] : '00';
  return `${d}T${hh}:${mm}`;
}

let fontsPromise = null;
/** تحميل خطوط الدعوة (مسموحة في CSP: fonts.googleapis.com / fonts.gstatic.com). */
export function ensureInvitationFonts() {
  if (fontsPromise) return fontsPromise;
  fontsPromise = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700;800&family=Cormorant+Garamond:ital,wght@1,600&display=swap';
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  return fontsPromise;
}
