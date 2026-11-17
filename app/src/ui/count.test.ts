import { describe, expect, test } from "vitest";
import type { Entry } from "../catalog/model.ts";
import { countLine } from "./count.ts";

const apps = (count: number): Entry[] => Array.from({ length: count }, () => ({ resource: false }) as Entry);
const links = (count: number): Entry[] => Array.from({ length: count }, () => ({ resource: true }) as Entry);

describe("a list's count", () => {
  const catalog = [...apps(1281), ...links(13)];

  test("a filtered list of apps counts apps", () => {
    expect(countLine(catalog, apps(8), true, "entry", "entries")).toBe("8 of 1,281 apps");
  });

  test("a filtered list with links among its results counts entries, the one total that holds both", () => {
    expect(countLine(catalog, [...apps(6), ...links(2)], true, "entry", "entries")).toBe("8 of 1,294");
  });

  test("a whole mixed list counts its apps and its links apart", () => {
    expect(countLine(catalog, catalog, false, "entry", "entries")).toBe("1,281 apps and 13 links");
  });

  test("a whole list of one kind uses its own noun", () => {
    expect(countLine(apps(89), apps(89), false, "app", "apps")).toBe("89 apps");
    expect(countLine(links(13), links(13), false, "link", "links")).toBe("13 links");
    expect(countLine(apps(1), apps(1), false, "app", "apps")).toBe("1 app");
  });
});
