// Thème clair/sombre appliqué avant le premier rendu (évite le flash). Clé : iae:theme
// Fichier externe (et non script inline) afin que la CSP puisse interdire 'unsafe-inline' pour les scripts.
// Règle : le thème par défaut est SOMBRE. Seul un choix explicite enregistré (« light » ou « dark »)
// le remplace ; la préférence du système n'est jamais consultée. Sans localStorage → sombre.
(function () {
  var t = 'dark';
  try {
    var saved = localStorage.getItem('iae:theme');
    if (saved === 'light' || saved === 'dark') t = saved;
  } catch (e) {
    // localStorage indisponible : on garde le thème sombre par défaut
  }
  document.documentElement.setAttribute('data-theme', t);
  // Même couleurs que applyTheme() dans src/hooks/useTheme.js
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#061631' : '#0a66c8');
})();
