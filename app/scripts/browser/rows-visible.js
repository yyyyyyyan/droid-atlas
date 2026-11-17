/*
 * Evaluated in the page (agent-browser eval --stdin): how much of the screen
 * the list gets on arrival. Reports where the first row starts, how many rows
 * are fully visible above the bottom bar, and the height of the chrome that
 * stays on screen while scrolling (sticky bar plus bottom bar).
 */
(() => {
  const nav = document.querySelector(".nav");
  const navBox = nav ? nav.getBoundingClientRect() : null;
  const bottomBar = navBox && navBox.width > navBox.height;
  const floor = bottomBar ? navBox.top : window.innerHeight;
  const rows = [...document.querySelectorAll(".rows > .row")].map((row) => row.getBoundingClientRect());
  const bar = document.querySelector("[data-sticky-bar]");
  const barHeight = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
  const first = rows[0] ?? null;
  return JSON.stringify({
    route: location.hash,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    scrollY: Math.round(window.scrollY),
    firstRowTop: first ? Math.round(first.top) : null,
    rowHeight: first ? Math.round(first.height) : null,
    fullRows: rows.filter((box) => box.top >= 0 && box.bottom <= floor + 0.5).length,
    stickyBar: barHeight,
    persistentChrome: barHeight + (bottomBar ? Math.round(navBox.height) : 0),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  });
})();
