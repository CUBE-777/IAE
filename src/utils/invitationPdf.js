import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import InvitationFace from '../components/invitation/InvitationFace';
import { ensureInvitationFonts } from './invitationFormat';
import '../styles/invitation.css';

const PAGE_W = 148;      // مم — نسبة البطاقة 0.9w × 1.25w
const PAGE_H = 205.6;

const waitImages = (host) => Promise.all([...host.querySelectorAll('img')].map((img) => (
  img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
)));

/** يصوّر نسخة ثابتة من البطاقة المفتوحة ويحفظها PDF. المكتبتان تُحمَّلان عند الضغط فقط. */
export async function downloadInvitationPdf({ guest, settings, startsAt }) {
  await ensureInvitationFonts();
  const host = document.createElement('div');
  host.className = 'inv-font inv-pdf-host';
  host.setAttribute('dir', 'ltr');
  host.setAttribute('lang', 'fr');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(createElement(InvitationFace, { guest, settings, startsAt, variant: 'static' }));
    await Promise.all([
      document.fonts.load('800 1em Cinzel'), document.fonts.load('700 1em Cinzel'),
      document.fonts.load('italic 600 1em "Cormorant Garamond"'),
    ]);
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await waitImages(host);
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const canvas = await html2canvas(host, { scale: 2, backgroundColor: '#071630', useCORS: true, logging: false });
    const pdf = new jsPDF({ unit: 'mm', format: [PAGE_W, PAGE_H], orientation: 'portrait', compress: true });
    pdf.setProperties({ title: `Invitation – ${guest.name}` });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H);
    const safe = guest.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'invitation';
    pdf.save(`Invitation-${safe}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}
