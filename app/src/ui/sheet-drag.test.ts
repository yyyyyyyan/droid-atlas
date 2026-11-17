import { describe, expect, test } from "vitest";
import { planTile, NAME_SIZES } from "./tile-plan.ts";
import { keyboardUp } from "./keyboard.ts";
import { heldPosition, releaseVelocity, settleSheet } from "./sheet-drag.ts";
import { monogram, nameInId } from "../lib/format.ts";

/** A phone screen of 688 px: the app sheet rests at 440 px (half) and 676 px (full). */
const HALF = 440;
const FULL = 676;
const TWO = [HALF, FULL];

describe("where a sheet comes to rest when it is let go", () => {
  test("a short, slow drag springs back to where it started", () => {
    expect(settleSheet(HALF - 40, 0, TWO)).toBe(HALF);
    expect(settleSheet(FULL - 60, 0, TWO)).toBe(FULL);
    expect(settleSheet(HALF + 50, 0, TWO)).toBe(HALF);
    expect(settleSheet(400 - 50, 0, [400])).toBe(400);
  });

  test("a slow drag down by more than about a quarter of the half sheet closes it", () => {
    expect(settleSheet(HALF * 0.75, 0, TWO)).toBe(HALF);
    expect(settleSheet(HALF * 0.7, 0, TWO)).toBe("close");
    expect(settleSheet(100, 0, TWO)).toBe("close");
  });

  test("a fling downward closes a half sheet even after a short travel", () => {
    expect(settleSheet(HALF - 30, 0.9, TWO)).toBe("close");
    expect(settleSheet(HALF - 30, 0.2, TWO)).toBe(HALF);
  });

  test("from full height, a drag down rests at half, and only a long drag or a hard fling closes", () => {
    expect(settleSheet(FULL - 140, 0, TWO)).toBe(HALF);
    expect(settleSheet(FULL - 60, 0.6, TWO)).toBe(HALF);
    expect(settleSheet(FULL - 60, 2, TWO)).toBe("close");
    expect(settleSheet(HALF * 0.6, 0, TWO)).toBe("close");
  });

  test("a drag or fling upward from half height expands the sheet", () => {
    expect(settleSheet(HALF + 130, 0, TWO)).toBe(FULL);
    expect(settleSheet(HALF + 30, -0.8, TWO)).toBe(FULL);
    expect(settleSheet(HALF + 30, 0, TWO)).toBe(HALF);
  });

  test("a sheet with one height either stays or closes", () => {
    expect(settleSheet(500, 0, [520])).toBe(520);
    expect(settleSheet(360, 0, [520])).toBe("close");
    expect(settleSheet(500, 1, [520])).toBe("close");
    expect(settleSheet(500, -3, [520])).toBe(520);
    expect(settleSheet(100, 0, [])).toBe("close");
  });
});

describe("the sheet under the finger", () => {
  test("it follows the finger one to one between closed and its tallest height", () => {
    expect(heldPosition(HALF, 100, FULL)).toBe(340);
    expect(heldPosition(HALF, -100, FULL)).toBe(540);
    expect(heldPosition(HALF, 1000, FULL)).toBe(0);
  });

  test("it resists being pulled past its tallest height, and gives a little", () => {
    expect(heldPosition(FULL, -40, FULL)).toBe(FULL + 10);
    expect(heldPosition(FULL, -4000, FULL)).toBe(FULL + 28);
  });
});

describe("the speed a sheet is let go at", () => {
  test("is the speed of the last tenth of a second, downward positive", () => {
    const samples = [{ y: 300, t: 0 }, { y: 300, t: 400 }, { y: 320, t: 440 }, { y: 380, t: 500 }];
    expect(releaseVelocity(samples, 510)).toBeCloseTo(0.8, 5);
    expect(releaseVelocity([{ y: 300, t: 0 }, { y: 200, t: 50 }], 60)).toBeCloseTo(-2, 5);
  });

  test("is nothing when the finger rested before it lifted", () => {
    expect(releaseVelocity([{ y: 300, t: 0 }, { y: 380, t: 60 }], 400)).toBe(0);
    expect(releaseVelocity([{ y: 300, t: 0 }], 10)).toBe(0);
    expect(releaseVelocity([], 10)).toBe(0);
  });
});

describe("whether the on-screen keyboard is up", () => {
  test("only while a text field has focus and the window is much shorter than it has been", () => {
    expect(keyboardUp(true, 496, 744)).toBe(true);
    expect(keyboardUp(false, 496, 744)).toBe(false);
    expect(keyboardUp(true, 744, 744)).toBe(false);
  });

  test("the browser's own bar sliding away is not a keyboard", () => {
    expect(keyboardUp(true, 688, 744)).toBe(false);
    expect(keyboardUp(true, 600, 744)).toBe(true);
  });
});

describe("a region tile", () => {
  test("sets its name over its count at the larger size when there is room, at the smaller when not", () => {
    expect(planTile({ w: 170, h: 130 }, "System & Tweaks", 178, false)).toMatchObject({ legible: true, nameSize: NAME_SIZES.phone[0] });
    expect(planTile({ w: 112, h: 110 }, "Personalization", 138, false)).toMatchObject({ legible: true, nameSize: NAME_SIZES.phone[1] });
  });

  test("uses no size but the two", () => {
    const names = ["Media", "Guides & Further Reading", "Privacy, Security & Network", "Device-specific", "Communication"];
    for (const name of names) {
      for (let w = 50; w <= 200; w += 15) {
        for (let h = 50; h <= 200; h += 25) {
          const plan = planTile({ w, h }, name, 100, false);
          expect(NAME_SIZES.phone as readonly number[]).toContain(plan.nameSize);
        }
      }
    }
  });

  test("says when it cannot hold its name and count, so the map enlarges it instead of clipping it", () => {
    expect(planTile({ w: 136, h: 45 }, "Guides & Further Reading", 13, false).legible).toBe(false);
    expect(planTile({ w: 60, h: 120 }, "Communication", 85, false).legible).toBe(false);
    expect(planTile({ w: 136, h: 86 }, "Guides & Further Reading", 13, false).legible).toBe(true);
  });

  test("adds category lines only on the wide layout, and only with room for at least two", () => {
    expect(planTile({ w: 170, h: 200 }, "Media", 148, false).categories).toBe(0);
    expect(planTile({ w: 260, h: 260 }, "Media", 148, true).categories).toBeGreaterThanOrEqual(2);
    expect(planTile({ w: 260, h: 110 }, "Media", 148, true).categories).toBe(0);
  });
});

describe("labels", () => {
  test("a placeholder carries the initials of the first two words, or the first two letters of one", () => {
    expect(monogram("AG Displays")).toBe("AD");
    expect(monogram("BlissLauncher")).toBe("Bl");
    expect(monogram("android-display-extend")).toBe("AD");
    expect(monogram("4Zones")).toBe("4z");
    expect(monogram("Élan Launcher")).toBe("ÉL");
    expect(monogram("X")).toBe("X");
    expect(monogram("…")).toBe("?");
  });

  test("an id gives the part most likely to be the app's name", () => {
    expect(nameInId("com.orgzly")).toBe("orgzly");
    expect(nameInId("app.upvpn.upvpn")).toBe("upvpn");
    expect(nameInId("github-1812z-hypercopy")).toBe("hypercopy");
    expect(nameInId("android-foss/blisslauncher")).toBe("blisslauncher");
    expect(nameInId("orgzly")).toBe("orgzly");
    expect(nameInId("org.x")).toBeNull();
    expect(nameInId("...")).toBeNull();
    expect(nameInId("")).toBeNull();
  });
});
