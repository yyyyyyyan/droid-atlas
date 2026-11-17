/*
 * Evaluated in the page (agent-browser eval --stdin) with reduced motion
 * emulated: lists every animation or transition that is running or could run
 * for longer than a frame. An empty `moving` list means nothing on the screen
 * moves on its own.
 */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seconds = (value) => Math.max(...value.split(",").map((part) => (part.trim().endsWith("ms") ? parseFloat(part) / 1000 : parseFloat(part))));
  const moving = [];
  for (const element of document.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    const transition = seconds(style.transitionDuration);
    const animation = style.animationName === "none" ? 0 : seconds(style.animationDuration);
    if (transition > 0.02 || animation > 0.02) {
      moving.push({ element: `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`, transition, animation });
    }
  }
  const running = document.getAnimations().filter((animation) => {
    const timing = animation.effect?.getComputedTiming();
    return animation.playState === "running" && timing && Number(timing.duration) > 20;
  }).length;
  return JSON.stringify({ route: location.hash, reduced, moving: moving.slice(0, 12), movingCount: moving.length, running });
})();
