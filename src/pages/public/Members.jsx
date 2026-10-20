import { useTranslation } from 'react-i18next';
import PeoplePage from './PeoplePage';

export default function Members() {
  const { t } = useTranslation();
  return (
    <PeoplePage
      listKey="members"
      title={t('peoplePage.membersTitle')}
      description={t('peoplePage.membersDescription')}
      crumbLabel={t('peoplePage.membersCrumb')}
      countLabel={t('peoplePage.membersCountLabel')}
      fallbackBadge={t('person.memberRole')}
      emptyText={t('peoplePage.membersEmpty')}
      switchHref="/board"
      switchLabel={t('peoplePage.membersSwitch')}
      searchPlaceholder={t('peoplePage.membersSearch')}
    />
  );
}
