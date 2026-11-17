/*
 * Evaluated in the page (agent-browser eval --stdin): what a list looks like
 * right now, for checking scroll restoration. Compare the output before
 * leaving a list and after coming back to it.
 */
(() => {
  const rows = [...document.querySelectorAll(".rows > .row")];
  const bar = document.querySelector("[data-sticky-bar]");
  const edge = bar ? bar.getBoundingClientRect().bottom : 0;
  const first = rows.find((row) => row.getBoundingClientRect().bottom > edge + 1);
  return JSON.stringify({
    route: location.hash,
    scrollY: Math.round(window.scrollY),
    firstVisibleRow: first ? first.dataset.row : null,
    firstVisibleTop: first ? Math.round(first.getBoundingClientRect().top) : null,
    renderedRows: rows.length,
    historyIdx: history.state ? history.state.idx : null,
  });
})();
