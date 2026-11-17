/**
 * What a result list shows frame by frame while it scrolls: on every
 * animation frame the page records where it is and whether rendered rows
 * cover the part of the list that is on screen, and how far they reach beyond
 * it in each direction.
 *
 * The compositor can run ahead of the page's own frames during a fling, so a
 * list is only safe when rows reach well past the screen in the direction of
 * travel; `ahead` is that distance, and a journey asserts a floor for it.
 */

import type { CDPSession, Page } from "@playwright/test";

export interface FrameSample {
  /** Milliseconds since sampling began. */
  t: number;
  scrollY: number;
  /** Px of the on-screen part of the list with no rendered row over it. */
  uncovered: number;
  /** Px of rendered rows beyond the screen in the direction the page is moving (both directions' smaller one at rest). */
  ahead: number;
  rows: number;
  /** True when the rendered rows end where the list itself ends in the direction of travel, so there is nothing more to render. */
  atEnd: boolean;
}

export async function startFrameSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: FrameSample[] = [];
    const began = performance.now();
    let lastY = window.scrollY;
    let running = true;
    const tick = (): void => {
      if (!running) return;
      const list = [...document.querySelectorAll<HTMLElement>("main ol, main ul")].find((element) => /sorted by/.test(element.getAttribute("aria-label") ?? ""));
      const first = list?.firstElementChild?.getBoundingClientRect();
      const last = list?.lastElementChild?.getBoundingClientRect();
      if (list && first && last) {
        const box = list.getBoundingClientRect();
        const top = Math.max(0, box.top);
        const bottom = Math.min(window.innerHeight, box.bottom);
        const y = window.scrollY;
        const direction = Math.sign(y - lastY);
        lastY = y;
        const below = last.bottom - window.innerHeight;
        const above = -first.top;
        const endBelow = Math.abs(last.bottom - box.bottom) < 1;
        const endAbove = Math.abs(first.top - box.top) < 1;
        samples.push({
          t: Math.round(performance.now() - began),
          scrollY: Math.round(y),
          uncovered: Math.round(Math.max(0, first.top - top) + Math.max(0, bottom - last.bottom)),
          ahead: Math.round(direction > 0 ? below : direction < 0 ? above : Math.min(below, above)),
          rows: list.childElementCount,
          atEnd: direction > 0 ? endBelow : direction < 0 ? endAbove : endBelow || endAbove,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as unknown as { __frames: { samples: FrameSample[]; stop(): void } }).__frames = {
      samples,
      stop() {
        running = false;
      },
    };
  });
}

export async function stopFrameSampling(page: Page): Promise<FrameSample[]> {
  return page.evaluate(() => {
    const frames = (window as unknown as { __frames: { samples: FrameSample[]; stop(): void } }).__frames;
    frames.stop();
    return frames.samples;
  });
}

/** Slows the page's main thread by `rate`, to stand in for a phone's processor. */
export async function throttleCpu(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
}

export interface FlingSummary {
  frames: number;
  /** Px per second, the fastest the page moved between two frames. */
  peakSpeed: number;
  distance: number;
  worstUncovered: number;
  /** The least `ahead` on any moving frame that was not at the list's end. */
  leastAhead: number;
  mostRows: number;
}

export function summarize(samples: readonly FrameSample[]): FlingSummary {
  let peakSpeed = 0;
  let leastAhead = Number.POSITIVE_INFINITY;
  for (let index = 1; index < samples.length; index += 1) {
    const now = samples[index];
    const before = samples[index - 1];
    if (!now || !before) continue;
    const elapsed = now.t - before.t;
    const moved = Math.abs(now.scrollY - before.scrollY);
    if (elapsed > 0) peakSpeed = Math.max(peakSpeed, (moved / elapsed) * 1000);
    if (moved > 0 && !now.atEnd) leastAhead = Math.min(leastAhead, now.ahead);
  }
  const ys = samples.map((sample) => sample.scrollY);
  return {
    frames: samples.length,
    peakSpeed: Math.round(peakSpeed),
    distance: samples.length ? Math.max(...ys) - Math.min(...ys) : 0,
    worstUncovered: Math.max(0, ...samples.map((sample) => sample.uncovered)),
    leastAhead: Number.isFinite(leastAhead) ? leastAhead : 0,
    mostRows: Math.max(0, ...samples.map((sample) => sample.rows)),
  };
}
