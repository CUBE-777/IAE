/** يمنع حقن الصيغ في Excel/Sheets: قيمة تبدأ بـ = + - @ أو Tab/CR تُسبق بـ ' فتُعامل نصًا. */
export function csvCell(value) {
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s().,-]+$/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename, rows, headers) {
  const csv = [headers.join(',')]
    .concat(rows.map((r) => headers.map((h) => csvCell(r[h])).join(',')))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
