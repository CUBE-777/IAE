/* Page hors ligne de l'administration : texte dans la langue choisie sur le site (clé iae:lang), sinon celle du navigateur.
   Script externe : la CSP n'autorise pas les scripts inline. */
(function () {
  var T = {
    ar: { dir: 'rtl', title: 'لا يوجد اتصال — IAE Admin', h1: 'لا يوجد اتصال بالإنترنت', p: 'تحتاج لوحة الإدارة إلى اتصال لعرض البيانات وحفظها. تحقّق من الشبكة ثم أعد المحاولة.', a: 'إعادة المحاولة' },
    fr: { dir: 'ltr', title: 'Hors ligne — IAE Admin', h1: 'Aucune connexion Internet', p: "Le panneau d'administration a besoin d'une connexion pour afficher et enregistrer les données. Vérifiez votre réseau puis réessayez.", a: 'Réessayer' },
    en: { dir: 'ltr', title: 'Offline — IAE Admin', h1: 'No internet connection', p: 'The admin panel needs a connection to show and save data. Check your network and try again.', a: 'Try again' }
  };
  var lang = 'ar';
  try {
    var saved = localStorage.getItem('iae:lang');
    var nav = String(navigator.language || '').slice(0, 2);
    lang = T[saved] ? saved : (!saved && T[nav] ? nav : 'ar');
  } catch (e) { /* localStorage indisponible : arabe par défaut */ }
  var t = T[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = t.dir;
  document.title = t.title;
  var set = function (sel, txt) { var el = document.querySelector(sel); if (el) el.textContent = txt; };
  set('h1', t.h1); set('p', t.p); set('a', t.a);
})();
