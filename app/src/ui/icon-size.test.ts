import { describe, expect, test } from "vitest";
import { wantsLargeIcon } from "./icon-size.ts";

describe("the sheet's large icon", () => {
  test("is not wanted where the list file already has more pixels than the screen shows", () => {
    for (const ratio of [1, 2, 3, 3.4]) expect(wantsLargeIcon(56, ratio), `at ${ratio}`).toBe(false);
  });

  test("is wanted where the screen has more pixels than the list file", () => {
    for (const ratio of [3.5, 3.75, 4]) expect(wantsLargeIcon(56, ratio), `at ${ratio}`).toBe(true);
  });
});
