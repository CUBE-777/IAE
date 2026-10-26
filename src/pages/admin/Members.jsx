import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import MembershipDocs from '../../components/admin/MembershipDocs';
import MemberFormModal from './MemberFormModal';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { downloadCsv } from '../../utils/csvExport';
import { fetchLinkedBoardMemberIds } from '../../services/supabase/adminBoard.service';
import {
  fetchMembersPage, softDeleteMember, fetchAllMembersForExport, PAGE_SIZE,
} from '../../services/supabase/adminMembers.service';

import { tr, trStrong } from '../../i18n/adminDict';
import {
  fetchMembershipSettings, fetchPaidMemberIds, recordAnnualMembership, fetchMemberPrivate, fetchMemberMemberships,
} from '../../services/supabase/membershipFlow.service';
const FIELD = (v) => (v == null || v === '' ? '—' : v);
const CSV_HEADERS = ['full_name', 'university', 'promotion', 'track', 'profession', 'city', 'email', 'phone', 'status'];

export default function Members() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const search = useDebouncedValue(searchInput, 350);

  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = add, object = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  // الانخراط السنوي: الموسم الحالي + من دفع فيه + نوافذ التجديد والتفاصيل
  const [settings, setSettings] = useState({ fee: null, season: null });
  const [paid, setPaid] = useState(new Set());
  const [renewTarget, setRenewTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [detail, setDetail] = useState(undefined); // undefined = تحميل، null = لا شيء

  const [boardOf, setBoardOf] = useState(new Map());
  useEffect(() => {
    fetchLinkedBoardMemberIds().then(setBoardOf).catch(() => {});
  }, []);

  const loadMembership = () => {
    fetchMembershipSettings()
      .then(async (st) => {
        setSettings(st);
        setPaid(await fetchPaidMemberIds(st.season));
      })
      .catch((err) => console.error('membership status load failed', err));
  };
  useEffect(loadMembership, []);

  const openDetails = async (m) => {
    setDetailTarget(m);
    setDetail(undefined);
    try {
      const [priv, history] = await Promise.all([fetchMemberPrivate(m.id), fetchMemberMemberships(m.id)]);
      setDetail({ priv, history });
    } catch (err) {
      console.error('member details load failed', err);
      setDetail(null);
    }
  };

  const doRenew = async (member) => {
    setRenewTarget(null);
    const t = window.notify?.loading(tr('جارٍ تسجيل الانخراط…'));
    try {
      await recordAnnualMembership({ memberId: member.id });
      t?.remove();
      window.notify?.success(tr('تم تسجيل الانخراط وإضافة الإيراد إلى الميزانية'));
      loadMembership();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذّر تسجيل الانخراط'));
    }
  };

  useEffect(() => {
    document.title = tr('الأعضاء — لوحة إدارة النادي');
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  const load = () => {
    setRows(null);
    setError(false);
    fetchMembersPage({ page, search, status })
      .then(({ rows: r, total: t }) => {
        setRows(r);
        setTotal(t);
      })
      .catch((err) => {
        console.error('تعذر تحميل الأعضاء:', err);
        window.notify?.fromError(err, tr('تعذر تحميل الأعضاء'));
        setError(true);
      });
  };

  useEffect(load, [page, search, status]);

  const doDelete = async (member) => {
    setDeleteTarget(null);
    const t = window.notify?.loading(tr('جاري الحذف...'));
    try {
      await softDeleteMember(member);
      t?.remove();
      window.notify?.success(tr('تم حذف العضو'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحذف'));
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    const t = window.notify?.loading(tr('جاري تجهيز الملف...'));
    try {
      const data = await fetchAllMembersForExport();
      downloadCsv('members.csv', data, CSV_HEADERS);
      t?.remove();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر تصدير الملف'));
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('الأعضاء')}
        subtitle={tr('إدارة جميع أعضاء النادي')}
        actions={
          <>
            <button className="admin-quick-action" disabled={exporting} onClick={exportCsv}>{tr('تصدير CSV')}</button>
            <button className="admin-quick-action" onClick={() => setFormTarget(null)}>{tr('+ إضافة عضو')}</button>
          </>
        }
      />

      <div className="admin-panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <input
            type="text"
            className="admin-input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder={tr('ابحث بالاسم، الجامعة، المهنة، المدينة، الدفعة...')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select className="admin-select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr('كل الحالات')}</option>
            <option value="active">{tr('نشط')}</option>
            <option value="inactive">{tr('غير نشط')}</option>
          </select>
        </div>

        {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
        {error && <div className="admin-state-box">{tr('تعذر تحميل الأعضاء.')}</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا يوجد أعضاء مطابقون.')}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr><th>{tr('الاسم')}</th><th>{tr('الجامعة')}</th><th>{tr('الدفعة')}</th><th>{tr('المهنة')}</th><th>{tr('المدينة')}</th><th>{tr('الحالة')}</th><th>{tr('الانخراط')}</th><th>{tr('إجراءات')}</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td data-label={tr('الاسم')}>{m.full_name}
                      {boardOf.has(m.id) && <> <span className="admin-badge admin-badge-approved" title={boardOf.get(m.id)}>{tr('عضو مكتب')}</span></>}
                    </td>
                    <td data-label={tr('الجامعة')}>{FIELD(m.university)}</td>
                    <td data-label={tr('الدفعة')}>{FIELD(m.promotion)}</td>
                    <td data-label={tr('المهنة')}>{FIELD(m.profession)}</td>
                    <td data-label={tr('المدينة')}>{FIELD(m.city)}</td>
                    <td data-label={tr('الحالة')}><span className={`admin-badge admin-badge-${m.status === 'active' ? 'approved' : 'rejected'}`}>{m.status === 'active' ? tr('نشط') : tr('غير نشط')}</span>
                      {m.status === 'active' && m.show_in_directory === false && (
                        <> <span className="admin-badge admin-badge-pending" title={tr('بموافقة العضو. عند إلغاء التحديد لا يظهر اسمه ولا صورته في الموقع.')}>{tr('غير ظاهر للعامة')}</span></>
                      )}
                    </td>
                    <td data-label={tr('الانخراط')}>
                      {settings.season ? (
                        <span className={`admin-badge admin-badge-${paid.has(m.id) ? 'approved' : 'pending'}`}>
                          {paid.has(m.id) ? tr('منخرط') : tr('غير منخرط')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => openDetails(m)}>{tr('تفاصيل')}</button>
                      {settings.season && !paid.has(m.id) && (
                        <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setRenewTarget(m)}>{tr('تجديد')}</button>
                      )}
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(m)}>{tr('تعديل')}</button>
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(m)}>{tr('حذف')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className="admin-btn admin-btn-ghost admin-btn-sm"
                style={p === page ? { background: 'var(--admin-accent)', color: 'var(--admin-bg)', borderColor: 'var(--admin-accent)' } : undefined}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <MemberFormModal
          member={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            load();
          }}
        />
      )}

      {renewTarget && (
        <Modal onClose={() => setRenewTarget(null)}>
          <h3>{tr('تأكيد الانخراط السنوي')}</h3>
          <p>{trStrong('سيتم تسجيل انخراط <strong>{{name}}</strong> للموسم {{season}} بمبلغ {{fee}} درهم وإضافته إلى الميزانية.', { name: renewTarget.full_name, season: settings.season, fee: settings.fee || '—' })}</p>
          {!settings.fee && <div className="admin-state-box">{tr('اضبط مبلغ الانخراط والموسم من صفحة الإعدادات أولاً.')}</div>}
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-primary" disabled={!settings.fee} onClick={() => doRenew(renewTarget)}>{tr('تأكيد الدفع وتسجيل الانخراط')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setRenewTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}

      {detailTarget && (
        <Modal onClose={() => setDetailTarget(null)}>
          <h3>{tr('تفاصيل العضو')}</h3>
          <p><strong>{tr('الاسم')}:</strong> {detailTarget.full_name}</p>
          <p><strong>{tr('البريد الإلكتروني')}:</strong> {FIELD(detailTarget.email)}</p>
          <p><strong>{tr('الهاتف')}:</strong> {FIELD(detailTarget.phone)}</p>
          {detail === undefined && <p>{tr('جارٍ التحميل…')}</p>}
          {detail === null && <p>{tr('تعذّر تحميل التفاصيل')}</p>}
          {detail && (
            <>
              {detail.priv ? (
                <>
                  <p><strong>{tr('تاريخ الميلاد')}:</strong> {FIELD(detail.priv.birth_date)}</p>
                  <p><strong>{tr('المستوى الدراسي')}:</strong> {FIELD(detail.priv.level)}</p>
                  <p><strong>{tr('المهارات')}:</strong> {FIELD(detail.priv.skills)}</p>
                  <p><strong>{tr('الاهتمامات')}:</strong> {FIELD(detail.priv.interests)}</p>
                  {(detail.priv.emergency_name || detail.priv.emergency_phone) && (
                    <>
                      <p><strong>{tr('جهة الاتصال الطارئة')}:</strong> {FIELD(detail.priv.emergency_name)} ({FIELD(detail.priv.emergency_relation)})</p>
                      <p><strong>{tr('هاتف الطوارئ')}:</strong> <span dir="ltr">{FIELD(detail.priv.emergency_phone)}</span></p>
                    </>
                  )}
                  <MembershipDocs data={detail.priv.form_data} />
                  <p><strong>{tr('الموافقة على النظام الداخلي')}:</strong> {detail.priv.rules_accepted_at ? tr('نعم') : tr('لا')}</p>
                </>
              ) : (
                <p>{tr('لا توجد بيانات إضافية لهذا العضو.')}</p>
              )}
              <h4>{tr('سجل الانخراطات')}</h4>
              {detail.history.length === 0 ? <p>—</p> : (
                <ul className="admin-summary-list">
                  {detail.history.map((h) => (
                    <li key={h.season}>{h.season} — {h.amount} MAD ({h.paid_at})</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-ghost" onClick={() => setDetailTarget(null)}>{tr('إغلاق')}</button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <h3>{tr('تأكيد الحذف')}</h3>
          <p>{trStrong('هل تريد حذف العضو <strong>{{name}}</strong>؟ يمكن استرجاعه لاحقًا من قاعدة البيانات.', { name: deleteTarget.full_name })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{tr('حذف')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
