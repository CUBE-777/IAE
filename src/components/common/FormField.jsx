import { useTranslation } from 'react-i18next';

/**
 * حقل نموذج موحّد: label مع نجمة إلزامية، رسالة خطأ قرب الحقل (role=alert)،
 * وربط aria-invalid / aria-describedby. `error` = مفتاح ترجمة أو [مفتاح, خيارات].
 * `children` دالة تستقبل خصائص الإتاحة وتُرجع عنصر الإدخال.
 */
export default function FormField({ id, label, required = false, error, children, className }) {
  const { t } = useTranslation();
  const errorId = error ? `${id}-error` : undefined;
  const message = error ? (Array.isArray(error) ? t(error[0], error[1]) : t(error)) : '';
  const a11y = {
    id,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': errorId,
    'aria-required': required || undefined,
  };
  return (
    <div className={`field${error ? ' field-invalid' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      {children(a11y)}
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
