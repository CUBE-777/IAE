import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import MemberPage from '../../components/member/MemberPage';
import { fetchMyCertificates } from '../../services/supabase/memberCertificates.service';
import { downloadCertificatePdf } from '../../utils/certificatePdf';
import { formatCertDate } from '../../utils/certificateRender';
import { canDownloadCertificate, memberCertErrorCode } from '../../utils/memberCertificates';
import '../../styles/member-certificates.css';

/**
 * «شهاداتي»: شهادات العضو الحالي فقط.
 * - القائمة من get_my_certificates() بلا وسائط: لا member_id من العميل ولا من الرابط (لا نقرأ useParams/useSearchParams هنا).
 * - لا نعرض الرمز الخام (يُسقط في التنظيف) ولا نسجّل أي بيانات شهادة في console.
 * - زر PDF للصالحة فقط؛ توليده يمرّ عبر get_certificate_render_data الذي يفرض الملكية ويرفض الملغاة.
 */
export default function MemberCertificates() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setStatus('loading');
    fetchMyCertificates()
      .then((list) => { if (alive) { setRows(list); setStatus('ok'); } })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => load(), [load]);

  const download = async (c) => {
    if (busyId || !canDownloadCertificate(c)) return;
    setBusyId(c.id);
    try {
      await downloadCertificatePdf(c.id);
      window.notify?.success(t('member.certificates.downloadOk'));
    } catch (err) {
      const code = memberCertErrorCode(err);
      window.notify?.error(t(`member.certificates.errors.${code}`, { defaultValue: t('member.certificates.errors.certificate_pdf_failed') }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <MemberPage titleKey="member.certificates.title" descriptionKey="member.certificates.description" pageTitleKey="member.certificates.pageTitle">
      {status === 'loading' && (
        <div role="status" aria-busy="true" aria-label={t('member.certificates.loading')}>
          <div className="sk sk-card" /><div className="sk sk-card" />
        </div>
      )}
      {status === 'error' && (
        <div className="ann-state ann-state-error" role="alert">
          <span>{t('member.certificates.loadError')}</span>
          <button type="button" className="interior-btn" onClick={load}>{t('common.retry')}</button>
        </div>
      )}
      {status === 'ok' && rows.length === 0 && <div className="ann-state">{t('member.certificates.empty')}</div>}
      {status === 'ok' && rows.length > 0 && (
        <ul className="mc-list">
          {rows.map((c) => {
            const valid = c.status === 'valid';
            const issued = formatCertDate(c.issued_at, i18n.language);
            return (
              <li key={c.id} className={`mc-card${valid ? '' : ' mc-card-revoked'}`}>
                <div className="mc-head">
                  <span className="mc-number">{c.certificate_number}</span>
                  <span className={`member-badge ${valid ? 'member-badge-approved' : 'member-badge-rejected'}`}>{t(`member.certificates.status.${c.status}`)}</span>
                </div>
                {c.campaign_title && <p className="mc-title">{c.campaign_title}</p>}
                <dl className="mc-meta">
                  {c.certificate_type && (
                    <div><dt>{t('member.certificates.fields.type')}</dt><dd>{t(`member.certificates.types.${c.certificate_type}`, { defaultValue: c.certificate_type })}</dd></div>
                  )}
                  {issued && <div><dt>{t('member.certificates.fields.issuedAt')}</dt><dd>{issued}</dd></div>}
                </dl>
                {valid ? (
                  <div className="mc-actions">
                    <button type="button" className="btn btn-gold" disabled={!!busyId} onClick={() => download(c)}>
                      <Download size={18} aria-hidden="true" />{' '}{busyId === c.id ? t('member.certificates.downloading') : t('member.certificates.download')}
                    </button>
                  </div>
                ) : (
                  <p className="mc-note">{t('member.certificates.revokedNote')}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </MemberPage>
  );
}
