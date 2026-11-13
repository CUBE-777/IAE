import Prism from 'prismjs/components/prism-core';

// مكوّنات اللغات (prism-*.js) تقرأ Prism كمتغيّر عالمي عند تقييمها؛ نضمن وجوده قبلها (prismSetup يستورد هذا الملف أولًا).
if (typeof globalThis !== 'undefined' && !globalThis.Prism) globalThis.Prism = Prism;

export default Prism;
