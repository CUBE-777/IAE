import { useEffect } from 'react';

/** يضبط عنوان التبويب ووصف الصفحة (meta description) ضمن SPA دون مكتبة إضافية. */
export function useDocumentMeta(title, description) {
  useEffect(() => {
    if (title) document.title = title;
    if (description == null) return undefined;
    let tag = document.querySelector('meta[name="description"]');
    const created = !tag;
    const previous = tag ? tag.getAttribute('content') : null;
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'description');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', String(description).slice(0, 300));
    return () => {
      if (created) tag.remove();
      else if (previous != null) tag.setAttribute('content', previous);
    };
  }, [title, description]);
}
