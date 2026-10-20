import { useTranslation } from 'react-i18next';
import PeoplePage from './PeoplePage';

export default function Board() {
  const { t } = useTranslation();
  return (
    <PeoplePage
      listKey="board"
      title={t('peoplePage.boardTitle')}
      description={t('peoplePage.boardDescription')}
      crumbLabel={t('peoplePage.boardCrumb')}
      countLabel={t('peoplePage.boardCountLabel')}
      fallbackBadge={t('peoplePage.boardBadge')}
      emptyText={t('peoplePage.boardEmpty')}
      switchHref="/members"
      switchLabel={t('peoplePage.boardSwitch')}
      searchPlaceholder={t('peoplePage.boardSearch')}
    />
  );
}
