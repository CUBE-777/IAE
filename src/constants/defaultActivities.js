/**
 * Contenu de secours des activités (affiché seulement si l'activité n'existe pas encore en base).
 * Arabe = langue source ; fr / en dans `translations` (même format que la colonne jsonb de la base).
 */
export const defaultActivities = {
  'annual-meeting': {
    title: "اللقاء السنوي للنادي",
    category: "تواصل وتأطير",
    location: "الجامعة",
    target: "جميع أعضاء النادي",
    image: '/logo.jpg',
    content: "<h3>أهداف اللقاء</h3><p>لقاء دوري يجمع أعضاء النادي لعرض المشاريع المنجزة، وتبادل الأفكار والخبرات، والتخطيط للموسم القادم.</p><h3>برنامج اللقاء</h3><ul><li>استقبال المشاركين وتقديم النادي.</li><li>عرض المشاريع والنماذج الأولية.</li><li>نقاشات وتبادل للخبرات التقنية.</li><li>التخطيط للأنشطة القادمة.</li></ul>",
    translations: {"fr": {"title": "Rencontre annuelle du club", "category": "Réseau et accompagnement", "location": "Université", "target_audience": "Tous les membres du club", "description": "<h3>Objectifs de la rencontre</h3><p>Une rencontre périodique qui réunit les membres du club pour présenter les projets réalisés, échanger des idées et préparer la saison suivante.</p><h3>Programme</h3><ul><li>Accueil des participants et présentation du club.</li><li>Présentation des projets et prototypes.</li><li>Discussions et échanges d'expériences techniques.</li><li>Planification des prochaines activités.</li></ul>"}, "en": {"title": "Annual Club Meetup", "category": "Networking and mentoring", "location": "University", "target_audience": "All club members", "description": "<h3>Goals of the meetup</h3><p>A recurring meetup that brings club members together to present completed projects, exchange ideas and plan the next season.</p><h3>Programme</h3><ul><li>Welcome and introduction to the club.</li><li>Presentation of projects and prototypes.</li><li>Discussions and sharing of technical experience.</li><li>Planning upcoming activities.</li></ul>"}},
  },
  'study-mentorship': {
    title: "ورشات الذكاء الاصطناعي والأنظمة المدمجة",
    category: "تكوين",
    location: "قاعات الجامعة / عن بُعد",
    target: "طلبة الجامعة",
    image: '/logo.jpg',
    content: "<h3>رؤية الورشات</h3><p>حصص تكوينية تطبيقية لاكتشاف أساسيات الذكاء الاصطناعي والبرمجة على المتحكمات الدقيقة، بمواكبة أعضاء النادي.</p><h3>المحاور</h3><ul><li>أساسيات البرمجة والخوارزميات.</li><li>مدخل إلى التعلم الآلي.</li><li>البرمجة على المتحكمات والحساسات.</li><li>إنجاز مشاريع تطبيقية صغيرة.</li></ul>",
    translations: {"fr": {"title": "Ateliers d'IA et de systèmes embarqués", "category": "Formation", "location": "Salles de l’université / à distance", "target_audience": "Étudiants de l'université", "description": "<h3>Vision des ateliers</h3><p>Des séances pratiques pour découvrir les bases de l'intelligence artificielle et la programmation de microcontrôleurs, avec l'accompagnement des membres du club.</p><h3>Thèmes</h3><ul><li>Bases de la programmation et des algorithmes.</li><li>Introduction à l'apprentissage automatique.</li><li>Programmation de microcontrôleurs et capteurs.</li><li>Réalisation de petits projets appliqués.</li></ul>"}, "en": {"title": "AI & Embedded Systems Workshops", "category": "Training", "location": "University rooms / online", "target_audience": "University students", "description": "<h3>About the workshops</h3><p>Hands-on sessions to discover the basics of artificial intelligence and microcontroller programming, guided by club members.</p><h3>Topics</h3><ul><li>Programming and algorithm basics.</li><li>Introduction to machine learning.</li><li>Microcontroller and sensor programming.</li><li>Building small applied projects.</li></ul>"}},
  },
  'student-support': {
    title: "المشاريع والنماذج الأولية",
    category: "مشاريع",
    location: "الجامعة",
    target: "أعضاء النادي",
    image: '/logo.jpg',
    content: "<h3>عن المشاريع</h3><p>عمل جماعي على مشاريع تقنية تجمع بين البرمجة والإلكترونيات، من تحديد الفكرة إلى إنجاز النموذج الأولي.</p><h3>مراحل العمل</h3><ul><li>اقتراح الأفكار واختيار المشاريع.</li><li>توزيع المهام وتكوين الفرق.</li><li>التطوير والاختبار.</li><li>عرض النتائج أمام أعضاء النادي.</li></ul>",
    translations: {"fr": {"title": "Projets et prototypes", "category": "Projets", "location": "Université", "target_audience": "Membres du club", "description": "<h3>À propos des projets</h3><p>Un travail collectif sur des projets techniques alliant programmation et électronique, de l'idée jusqu'au prototype.</p><h3>Étapes</h3><ul><li>Proposition d'idées et choix des projets.</li><li>Répartition des tâches et constitution des équipes.</li><li>Développement et tests.</li><li>Présentation des résultats aux membres du club.</li></ul>"}, "en": {"title": "Projects & Prototypes", "category": "Projects", "location": "University", "target_audience": "Club members", "description": "<h3>About the projects</h3><p>Collective work on technical projects combining programming and electronics, from the first idea to a working prototype.</p><h3>Stages</h3><ul><li>Proposing ideas and selecting projects.</li><li>Assigning tasks and forming teams.</li><li>Development and testing.</li><li>Presenting results to club members.</li></ul>"}},
  },
  'volunteer-initiatives': {
    title: "أنشطة التوعية والمشاركة",
    category: "توعية",
    location: "الجامعة ومحيطها",
    target: "الطلبة والمجتمع الجامعي",
    image: '/logo.jpg',
    content: "<h3>رسالة النشاط</h3><p>لقاءات وأنشطة مفتوحة لنشر الثقافة التقنية بين الطلبة وتعريفهم بمجالات الذكاء الاصطناعي والأنظمة المدمجة.</p><h3>أمثلة على الأنشطة</h3><ul><li>لقاءات تعريفية مفتوحة.</li><li>عروض توضيحية للمشاريع.</li><li>مشاركة المعرفة والموارد التعليمية.</li></ul>",
    translations: {"fr": {"title": "Sensibilisation et partage", "category": "Sensibilisation", "location": "Université et environs", "target_audience": "Étudiants et communauté universitaire", "description": "<h3>Mission</h3><p>Des rencontres et activités ouvertes pour diffuser la culture technique parmi les étudiants et leur faire découvrir l'IA et les systèmes embarqués.</p><h3>Exemples d'activités</h3><ul><li>Rencontres de présentation ouvertes à tous.</li><li>Démonstrations de projets.</li><li>Partage de connaissances et de ressources pédagogiques.</li></ul>"}, "en": {"title": "Outreach & Sharing", "category": "Outreach", "location": "University and surroundings", "target_audience": "Students and the university community", "description": "<h3>Mission</h3><p>Open meetups and activities that spread technical culture among students and introduce them to AI and embedded systems.</p><h3>Examples</h3><ul><li>Open introductory meetups.</li><li>Project demonstrations.</li><li>Sharing knowledge and learning resources.</li></ul>"}},
  },
};
