export default function AdminPageHeader({ title, subtitle, actions }) {
  return (
    <div className="admin-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="admin-page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="admin-quick-actions">{actions}</div>}
    </div>
  );
}
