// Thème clair/sombre appliqué avant le premier rendu (évite le flash). Clé : iae:theme
// Fichier externe (et non script inline) afin que la CSP puisse interdire 'unsafe-inline' pour les scripts.
(function () {
  try {
    var t = localStorage.getItem('iae:theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
