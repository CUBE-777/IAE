import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import InvitationScene from '../../components/invitation/InvitationScene';
import { getInvitation, respondInvitation } from '../../services/supabase/invitations.service';
import { downloadInvitationPdf } from '../../utils/invitationPdf';
import '../../styles/invitation.css';

/** صفحة الدعوة العامة /invite/:token — بدون Navbar/Footer، غير مفهرسة، بالفرنسية (LTR). */
export default function Invitation() {
  const { token } = useParams();
  const [data, setData] = useState(undefined); // undefined = تحميل، null = غير صالحة
  const [rsvp, setRsvp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    getInvitation(token)
      .then((d) => { if (!alive) return; setData(d || null); setRsvp(d?.rsvp || null); if (d) document.title = `Invitation – ${d.guest_name}`; })
      .catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [token]);

  if (data === undefined) return <div className="inv-root inv-font inv-msg" dir="ltr" lang="fr">…</div>;
  if (data === null) {
    return <div className="inv-root inv-font inv-msg" dir="ltr" lang="fr"><p>Cette invitation n’est plus disponible.</p></div>;
  }

  const guest = { name: data.guest_name, title: data.guest_title, gender: data.gender };

  const answer = async (value) => {
    setBusy(true); setMsg('');
    try { await respondInvitation(token, value); setRsvp(value); } catch { setMsg('Une erreur est survenue, réessayez.'); }
    setBusy(false);
  };
  const pdf = async () => {
    setBusy(true); setMsg('');
    try { await downloadInvitationPdf({ guest, settings: data, startsAt: data.starts_at }); } catch { setMsg('Téléchargement impossible, réessayez.'); }
    setBusy(false);
  };

  return (
    <InvitationScene guest={guest} settings={data} startsAt={data.starts_at}>
      {(done) => (
        <div className={`inv-actions${done ? ' show' : ''}`}>
          <button type="button" disabled={busy} className={`inv-btn${rsvp === 'yes' ? ' on' : ''}`} onClick={() => answer('yes')}>Je confirme</button>
          <button type="button" disabled={busy} className={`inv-btn${rsvp === 'no' ? ' on' : ''}`} onClick={() => answer('no')}>Je décline</button>
          {data.allow_download ? <button type="button" disabled={busy} className="inv-btn" onClick={pdf}>PDF ⬇</button> : null}
          {msg ? <span className="inv-err">{msg}</span> : null}
        </div>
      )}
    </InvitationScene>
  );
}
