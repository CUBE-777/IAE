/**
 * رسم صيانة الألعاب: يد ألعاب + مفتاح ربط + ترس يدور. SVG مضمّن بلا طلبات شبكة، ألوانه من tokens عبر أصناف CSS
 * (games-maintenance.css) فيتبع الوضعين الفاتح/الداكن، ولا يُعكس في RTL (متناظر). الحركة تتوقف عند prefers-reduced-motion.
 */
export default function GamesMaintenanceArt({ label }) {
  return (
    <svg className="gm-art" viewBox="0 0 240 180" role="img" aria-label={label} focusable="false">
      <defs>
        {/* فتحة مفتاح الربط: قناع ثابت المعرّف (نسخة واحدة من الرسم في الصفحة) */}
        <mask id="gm-wrench-mask" maskUnits="userSpaceOnUse" x="-30" y="-70" width="60" height="140">
          <rect x="-30" y="-70" width="60" height="140" fill="#fff" />
          <rect x="-6.5" y="-62" width="13" height="23" fill="#000" />
        </mask>
      </defs>
      <ellipse className="gm-shadow" cx="120" cy="160" rx="78" ry="7" />
      <g className="gm-gear" aria-hidden="true">
        <circle className="gm-gear-teeth" cx="120" cy="32" r="17" />
        <circle className="gm-gear-core" cx="120" cy="32" r="12" />
        <circle className="gm-gear-hole" cx="120" cy="32" r="4.5" />
      </g>
      <path
        className="gm-body"
        d="M62 62C40 62 24 102 28 132c3 20 22 22 32 8l16-22h88l16 22c10 14 29 12 32-8 4-30-12-70-34-70z"
      />
      <path className="gm-dpad" d="M71 77h10v7h7v10h-7v7H71v-7h-7V84h7z" />
      <circle className="gm-btn gm-btn-a" cx="166" cy="80" r="6.5" />
      <circle className="gm-btn gm-btn-b" cx="179" cy="93" r="6.5" />
      <rect className="gm-pill" x="108" y="84" width="10" height="4" rx="2" />
      <rect className="gm-pill" x="122" y="84" width="10" height="4" rx="2" />
      <g transform="translate(190 124) rotate(40)">
        <circle className="gm-wrench" cx="0" cy="-40" r="15" mask="url(#gm-wrench-mask)" />
        <rect className="gm-wrench" x="-6" y="-30" width="12" height="70" rx="6" />
        <circle className="gm-wrench-hole" cx="0" cy="31" r="2.5" />
      </g>
    </svg>
  );
}
