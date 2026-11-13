import { useTranslation } from 'react-i18next';
import { CodeCompletionType, FillBlanksType } from './BlankTypes';
import ChoiceType from './ChoiceTypes';
import FindErrorType from './FindErrorType';
import MatchType from './MatchType';
import ReorderType from './ReorderType';
import { builderType, pickText } from './builderContent';

/**
 * واجهة اللاعب لتحديات المحرر السبعة (answer_type = 'builder'): السؤال والتعليمات والتلميحات + مساحة التفاعل بحسب challenge_type.
 * تعرض المحتوى العلني فقط (content من إصدار المحاولة المثبَّت)، وتجمع اختيارات اللاعب في value؛ لا تحقّق ولا نتيجة ولا نقاط هنا:
 * الإرسال والتصحيح من الصفحة إلى الخادم. لا تنفيذ لأي كود ولا حقول إدخال حرّ.
 *
 *   value/onChange : حالة الواجهة (تُحوَّل لعقد الإرسال بواسطة toBuilderAnswer في builderContent).
 *   lang/defaultLang : لغة الواجهة ولغة الإصدار الافتراضية (احتياط النصوص).
 */
export default function BuilderChallenge({ content, value, onChange, disabled, lang, defaultLang }) {
  const { t } = useTranslation();
  const type = builderType(content);
  const L = (o) => pickText(o, lang, defaultLang);
  const prompt = L(content.prompt);
  const instructions = L(content.instructions);
  const hints = (Array.isArray(content.hints) ? content.hints : []).slice(0, 5).map(L).filter(Boolean);
  const props = { content, value, onChange, disabled, L };

  let body = null;
  if (type === 'multiple_choice') body = <ChoiceType {...props} />;
  else if (type === 'predict_output') body = <ChoiceType {...props} literal />;
  else if (type === 'fill_blanks') body = <FillBlanksType {...props} />;
  else if (type === 'code_completion') body = <CodeCompletionType {...props} />;
  else if (type === 'drag_reorder') body = <ReorderType {...props} />;
  else if (type === 'find_error') body = <FindErrorType {...props} />;
  else if (type === 'match_pairs') body = <MatchType {...props} />;

  return (
    <div className="gp-bc" data-type={type}>
      {prompt && <p className="gp-prompt gp-pre" dir="auto">{prompt}</p>}
      {instructions && <p className="gp-sub gp-pre" dir="auto">{instructions}</p>}
      {body}
      {hints.length > 0 && (
        <details className="gp-hints">
          <summary>{t('games.play.interactive.hints')}</summary>
          <ul>{hints.map((h, i) => <li key={i} dir="auto">{h}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
