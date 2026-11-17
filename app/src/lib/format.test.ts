import { afterEach, describe, expect, it } from "vitest";
import { formatDate, formatDay } from "./format.ts";

/** The daily build runs at about 01:30 UTC: still the evening before in the Americas. */
const BUILT = Date.parse("2026-11-17T01:30:49.758Z");
const zone = process.env.TZ;

describe("a catalog's date is the day it was built where the reader is", () => {
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("is the evening before in São Paulo, with the reader's own zone", () => {
    process.env.TZ = "America/Sao_Paulo";
    expect(formatDay(BUILT)).toBe("Nov 16, 2026");
  });

  it("is the same day in Tokyo and in UTC", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(formatDay(BUILT)).toBe("Nov 17, 2026");
    expect(formatDay(BUILT, "UTC")).toBe("Nov 17, 2026");
  });

  it("follows a zone named outright", () => {
    expect(formatDay(BUILT, "America/Los_Angeles")).toBe("Nov 16, 2026");
    expect(formatDay(BUILT, "Pacific/Kiritimati")).toBe("Nov 17, 2026");
  });

  it("leaves a calendar day as the day it names, wherever the reader is", () => {
    process.env.TZ = "America/Sao_Paulo";
    expect(formatDate(Date.parse("2026-11-16"))).toBe("Nov 16, 2026");
  });
});
