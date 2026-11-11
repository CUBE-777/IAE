import { useEffect, useState } from 'react';
import { introFor, dateLabel, timeLabel } from '../../utils/invitationFormat';

function Countdown({ startsAt }) {
  const target = new Date(startsAt).getTime();
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()) / 1000);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, target - Date.now()) / 1000), 1000);
    return () => clearInterval(t);
  }, [target]);
  const cells = [['jours', Math.floor(left / 86400)], ['heures', Math.floor((left % 86400) / 3600)], ['min', Math.floor((left % 3600) / 60)], ['sec', Math.floor(left % 60)]];
  return (
    <div className="inv-cd" aria-live="off">
      {cells.map(([label, n]) => <div key={label}><b>{String(n).padStart(2, '0')}</b><span>{label}</span></div>)}
    </div>
  );
}

/**
 * وجه البطاقة (نفس تصميم invitation.html). variant='static' للـ PDF: بلا عدّاد ولا لمعان ولا نص متدرّج (html2canvas).
 * guest: { name, title, gender } — settings: حقول إعدادات الدعوة — startsAt: ISO
 */
export default function InvitationFace({ guest, settings, startsAt, variant = 'live' }) {
  const isStatic = variant === 'static';
  return (
    <div className={`inv-face${isStatic ? ' inv-face--static' : ''}`}>
      <img className="inv-fac" src="/invite/faculty.png" alt="Faculté des Sciences Appliquées, Université Ibn Zohr, Agadir" />
      <div>
        <p className="inv-who">{guest.name}</p>
        {guest.title ? <p className="inv-role">{guest.title}</p> : null}
      </div>
      <p className="inv-soft">{introFor(settings.intro_text, guest.gender)}</p>
      <div>
        <p className="inv-h1">{settings.headline_1}</p>
        <p className="inv-h2">{settings.headline_2}</p>
      </div>
      <p className="inv-soft">{settings.subtitle_text}</p>
      <div className="inv-date">{dateLabel(startsAt)}</div>
      <div>
        <p className="inv-soft">à partir de</p>
        <div className="inv-time">{timeLabel(startsAt)}</div>
      </div>
      {settings.venue_text ? <p className="inv-soft">{settings.venue_text}</p> : null}
      {isStatic ? null : <Countdown startsAt={startsAt} />}
      <p className="inv-thx">{settings.thanks_text}</p>
    </div>
  );
}
