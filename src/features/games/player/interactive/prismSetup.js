/**
 * PrismJS للعرض فقط (تلوين الأكواد). يُحمَّل كسولًا من loadHighlighter فلا يدخل في حزمة الصفحة الأولى، ولا ننفّذ به أي كود:
 * Prism.tokenize يحلّل النص إلى رموز فقط. أمر الاستيراد مهمّ: النواة أولًا ثم اللغات بحسب اعتماداتها.
 * اللغات = قائمة code_lang في Builder (0057): text (بلا تلوين) · python · javascript · typescript · java · c · cpp · csharp · php · sql · html · css · bash · json.
 */
import Prism from './prismCore';
import 'prismjs/components/prism-markup'; // html
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-markup-templating'; // اعتماد php
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';

export default Prism;
