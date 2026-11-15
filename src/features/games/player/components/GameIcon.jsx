import {
  BarChart3, Binary, Brain, Bug, Code2, Compass, Cpu, Database, FlaskConical, Gamepad2, GitBranch, Globe,
  Languages, Lightbulb, Lock, Network, Palette, Puzzle, Rocket, ShieldCheck, Sigma, Smartphone, Swords, Terminal, Zap,
} from 'lucide-react';

/**
 * أيقونة اللعبة: رمز SVG (من lucide المستعمل أصلًا في المشروع) فوق خلفية SVG خفيفة بثلاثة أنماط ونبرات لونية متناسقة مع هوية IAE.
 * الاختيار حتمي: كلمات مفتاحية من slug/عنوان اللعبة/تصنيفها، وإلا تجزئة ثابتة للـ slug. لا بيانات جديدة ولا طلبات شبكة.
 */
const RULES = [
  [/python|javascript|\bjs\b|typescript|java|\bc\+\+|\bphp|code|program|برمج|كود|coding|dev/i, Code2, 'gold'],
  [/sql|data|database|بيان|قاعد|base de/i, Database, 'navy'],
  [/web|html|css|http|site|ويب|موقع|internet/i, Globe, 'teal'],
  [/secur|cyber|hack|crypto|أمن|حماي|sécur/i, ShieldCheck, 'rose'],
  [/lock|password|auth|كلمة/i, Lock, 'rose'],
  [/bug|debug|error|خطأ|أخطاء|erreur/i, Bug, 'rose'],
  [/algo|logic|منطق|خوارزم|binary|binaire/i, Binary, 'indigo'],
  [/network|réseau|شبك|cloud|سحاب|devops/i, Network, 'teal'],
  [/ai\b|ia\b|machine|ml\b|brain|ذكاء|intelligen/i, Brain, 'indigo'],
  [/hardware|cpu|system|os\b|linux|عتاد|نظام|système/i, Cpu, 'navy'],
  [/shell|bash|terminal|command|أوامر|commande|cli/i, Terminal, 'gold'],
  [/git|version|إصدار|branch/i, GitBranch, 'indigo'],
  [/math|رياض|calcul|sigma|maths/i, Sigma, 'gold'],
  [/mobile|android|ios|app\b|تطبيق|application/i, Smartphone, 'teal'],
  [/design|ui\b|ux\b|color|تصميم|couleur/i, Palette, 'rose'],
  [/lang|english|french|arab|لغة|langue|vocab/i, Languages, 'teal'],
  [/analytic|stat|chart|إحصاء|تحليل/i, BarChart3, 'navy'],
  [/science|lab|علوم|مختبر|physic|chem/i, FlaskConical, 'teal'],
  [/quiz|puzzle|riddle|لغز|أحجي|énigme/i, Puzzle, 'gold'],
  [/battle|duel|versus|تحدي|défi|compet/i, Swords, 'rose'],
  [/innov|idea|startup|فكرة|ابتكار|entrepre/i, Lightbulb, 'gold'],
  [/launch|space|rocket|إطلاق|مشروع|project/i, Rocket, 'indigo'],
  [/speed|fast|سرع|rapid|flash/i, Zap, 'gold'],
  [/explor|discover|general|عام|استكشاف|culture/i, Compass, 'navy'],
];
const FALLBACK = [Puzzle, Compass, Zap, Lightbulb, Rocket, Brain, Code2, Gamepad2];
const TONES = ['gold', 'navy', 'teal', 'indigo', 'rose'];

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** { Icon, tone, pattern } لكل لعبة. */
export function pickGameVisual(game, categoryText = '') {
  const seed = String(game?.slug || game?.id || 'game');
  const title = game?.title && typeof game.title === 'object' ? Object.values(game.title).join(' ') : String(game?.title || '');
  const hay = `${seed} ${title} ${categoryText}`;
  const h = hash(seed);
  const hit = RULES.find(([re]) => re.test(hay));
  const Icon = hit ? hit[1] : FALLBACK[h % FALLBACK.length];
  const tone = hit ? hit[2] : TONES[h % TONES.length];
  return { Icon, tone, pattern: (h >> 3) % 3 };
}

function Backdrop({ pattern }) {
  return (
    <svg className="gi-bg" viewBox="0 0 64 64" focusable="false" aria-hidden="true">
      <rect className="gi-plate" x="2" y="2" width="60" height="60" rx="18" />
      {pattern === 0 && (<><circle className="gi-orb" cx="52" cy="12" r="14" /><path className="gi-wave" d="M2 46c12-10 22 4 32-2s20-8 28-2v20H2z" /></>)}
      {pattern === 1 && (<><circle className="gi-ring" cx="32" cy="32" r="22" /><circle className="gi-ring" cx="32" cy="32" r="14" /><circle className="gi-dot" cx="50" cy="14" r="3" /></>)}
      {pattern === 2 && (<><path className="gi-grid" d="M2 22h60M2 42h60M22 2v60M42 2v60" /><circle className="gi-orb" cx="14" cy="50" r="12" /></>)}
    </svg>
  );
}

/** size: sm | md | lg | xl */
export default function GameIcon({ game, category, size = 'md', className = '' }) {
  const { Icon, tone, pattern } = pickGameVisual(game, category);
  const px = { sm: 18, md: 28, lg: 38, xl: 52 }[size] || 28;
  return (
    <span className={`gi gi-${size} ${className}`.trim()} data-tone={tone} aria-hidden="true">
      <Backdrop pattern={pattern} />
      <Icon className="gi-glyph" size={px} strokeWidth={1.8} />
    </span>
  );
}
