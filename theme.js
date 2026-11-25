// Load before the stylesheet on both pages so the saved theme is used on first paint.
const BBTheme = (() => {
  const key = "battag_theme";
  const themes = ["light", "dark", "evergreen"];
  const root = document.documentElement;

  let saved;
  try {
    saved = localStorage.getItem(key);
  } catch {
    // The default theme also works when browser storage is unavailable.
  }
  root.dataset.theme = themes.includes(saved) ? saved : "light";

  return {
    set(theme) {
      if (!themes.includes(theme)) return;
      root.dataset.theme = theme;
      try {
        localStorage.setItem(key, theme);
      } catch {
        // Apply the theme for this page even when it cannot be saved.
      }
    }
  };
})();
