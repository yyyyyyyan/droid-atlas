/*
 * Applies the stored theme and density before the first paint, so a manual
 * override never flashes the other theme. A separate file because the
 * Content-Security-Policy allows no inline script. Everything it sets is set
 * again by src/state/settings.ts once the app runs.
 */
(function () {
  var theme = "system";
  var density = "comfortable";
  try {
    var stored = JSON.parse(localStorage.getItem("droid-atlas:v1:settings") || "null");
    if (stored && stored.v === 1) {
      if (stored.theme === "light" || stored.theme === "dark") theme = stored.theme;
      if (stored.density === "compact") density = "compact";
    }
  } catch (error) {
    /* Unreadable settings: the defaults stand. */
  }
  var dark = theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  var root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.density = density;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#000000" : "#fbfaf8");
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", dark ? "dark" : "light");
})();
