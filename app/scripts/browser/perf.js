/*
 * Evaluated in the page on a list route, after it has loaded: reads the boot
 * timings the app records and then times live interactions against the
 * budgets in docs/ARCHITECTURE.md. Returns a promise of a JSON string.
 *
 * - boot: the largest single JSON parse, the join, the model build, and when
 *   the first view was on screen (all from `performance` entries);
 * - typing: for each keystroke of a query, the time from the input event to
 *   the end of the layout it causes (the work that must fit in one frame);
 * - filter: the same for toggling a quick filter;
 * - scroll: frame intervals while the list is scrolled by script.
 */
(async () => {
  const round = (value) => Math.round(value * 10) / 10;
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    return document.body.offsetHeight;
  };
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  const measures = performance.getEntriesByType("measure");
  const durations = (name) => measures.filter((entry) => entry.name === name).map((entry) => entry.duration);
  const mark = (name) => performance.getEntriesByName(name, "mark")[0]?.startTime ?? null;
  const navigation = performance.getEntriesByType("navigation")[0];
  const boot = {
    largestParseMs: round(Math.max(0, ...durations("atlas:json-parse"))),
    totalParseMs: round(durations("atlas:json-parse").reduce((sum, value) => sum + value, 0)),
    joinMs: round(Math.max(0, ...durations("atlas:join"))),
    modelMs: round(Math.max(0, ...durations("atlas:model-build"))),
    catalogLoadedAtMs: round(mark("atlas:catalog-loaded") ?? -1),
    firstViewAtMs: round(mark("atlas:first-view") ?? -1),
    responseEndMs: navigation ? round(navigation.responseEnd) : null,
    transferKB: round(performance.getEntriesByType("resource").reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0) / 1024),
  };

  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
  const worst = (values) => (values.length ? Math.max(...values) : null);

  /* The first pass runs code the engine has not optimized yet; the later passes are what a user who keeps typing gets. */
  const input = document.querySelector("#search-input");
  const typingPasses = [];
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (let pass = 0; pass < 4; pass += 1) {
      const times = [];
      for (const text of ["t", "te", "ter", "term", "termu", "termux", "termu", "term", "ter", "te", "t", ""]) {
        const start = performance.now();
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
        times.push(round(performance.now() - start));
        await frame();
        await frame();
      }
      typingPasses.push(times);
    }
  }
  const warmTyping = typingPasses.slice(1).flat();
  const typing = {
    firstPassMs: typingPasses[0] ?? [],
    warmMedianMs: median(warmTyping),
    warmWorstMs: worst(warmTyping),
  };

  const filterTimes = [];
  for (let run = 0; run < 8; run += 1) {
    const chip = document.querySelector(".strip-chips .tchip.is-on:last-child") ?? document.querySelector(".bar-suggest .tchip");
    if (!chip) break;
    const start = performance.now();
    chip.click();
    await settle();
    filterTimes.push(round(performance.now() - start));
    await frame();
    await frame();
  }
  const filter = { firstMs: filterTimes[0] ?? null, warmMedianMs: median(filterTimes.slice(2)), warmWorstMs: worst(filterTimes.slice(2)) };

  const intervals = [];
  let last = performance.now();
  for (let step = 0; step < 60; step += 1) {
    window.scrollBy(0, 240);
    await frame();
    const now = performance.now();
    intervals.push(now - last);
    last = now;
  }
  window.scrollTo(0, 0);
  intervals.sort((a, b) => a - b);
  const scroll = {
    medianFrameMs: round(intervals[Math.floor(intervals.length / 2)]),
    worstFrameMs: round(intervals[intervals.length - 1]),
    over20ms: intervals.filter((value) => value > 20).length,
  };

  return JSON.stringify({ route: location.hash, rows: document.querySelectorAll(".rows > .row").length, boot, typing, filter, scroll });
})();
