import { useNoindex } from '../../hooks/useNoindex';
import '../../styles/member-shell.css';

/** غلاف صفحات الدخول والتفعيل والمساعدة: بطاقة مركزية بشعار النادي بدل الهيرو الكبير. */
export default function MemberAuthShell({ title, description, children }) {
  useNoindex();
  return (
    <div className="ma-wrap">
      <main className="ma-card">
        <img className="ma-logo" src="/logo.jpg" alt="" width="64" height="64" />
        <h1>{title}</h1>
        {description && <p className="ma-desc">{description}</p>}
        {children}
      </main>
    </div>
  );
}
