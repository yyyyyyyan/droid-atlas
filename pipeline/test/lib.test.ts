import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRepo, parseStoreLink, variantOf } from "../forge.ts";
import { parseFirstSeen } from "../lib/git.ts";
import { classifyLicense } from "../lib/licenses.ts";
import { retry, HttpError, isTransient } from "../lib/retry.ts";
import { currentId, licenseGate, loadSpdxList, parseSpdx } from "../lib/spdx.ts";
import { htmlToText, httpUrl, markdownLinks, markdownToText, slug, truncate } from "../lib/text.ts";

test("httpUrl keeps only http(s) URLs without credentials", () => {
  assert.equal(httpUrl("https://example.org/a"), "https://example.org/a");
  assert.equal(httpUrl("javascript:alert(1)"), null);
  assert.equal(httpUrl("data:text/html,<b>x</b>"), null);
  assert.equal(httpUrl("intent://scan#Intent;end"), null);
  assert.equal(httpUrl("https://user:pass@example.org/"), null);
  assert.equal(httpUrl("not a url"), null);
  assert.equal(httpUrl("doc/x.md", "https://github.com/o/r/blob/master/"), "https://github.com/o/r/blob/master/doc/x.md");
});

test("markdown and HTML are reduced to plain text", () => {
  assert.equal(markdownToText("A **bold** [link](https://x.org) and `code` <img src=x onerror=alert(1)>"), "A bold link and code");
  assert.equal(htmlToText("<p>One &amp; two</p><script>alert(1)</script><ul><li>three</li></ul>"), "One & two\n• three");
  assert.equal(markdownToText("bidi‮override\u0000"), "bidioverride");
  assert.deepEqual(markdownLinks("see [a](https://a.org) and [b](javascript:x)"), [{ name: "a", url: "https://a.org/" }]);
});

test("slug and truncate", () => {
  assert.equal(slug("Café & Tools / Ñ"), "cafe-and-tools-n");
  assert.equal(truncate("word ".repeat(30).trim(), 50)?.endsWith("…"), true);
  assert.equal(truncate("short", 50), "short");
});

test("parseRepo accepts repositories and their README pages, not documents or sub-directories", () => {
  assert.equal(parseRepo("https://github.com/Owner/Name")?.key, "github:owner/name");
  assert.equal(parseRepo("https://github.com/o/n.git")?.slug, "o/n");
  assert.equal(parseRepo("https://github.com/o/n/blob/main/README_en.md")?.slug, "o/n");
  assert.equal(parseRepo("https://github.com/o/n/releases")?.slug, "o/n");
  assert.equal(parseRepo("https://github.com/o/n/blob/master/doc/Guide.md"), null);
  assert.equal(parseRepo("https://github.com/o/n/tree/main/app"), null);
  assert.equal(parseRepo("https://github.com/o"), null);
  assert.equal(parseRepo("https://gitlab.com/group/sub/name/-/tree/main")?.slug, "group/sub/name");
  assert.equal(parseRepo("https://codeberg.org/o/n")?.host, "codeberg");
  assert.equal(parseRepo("https://git.sr.ht/~o/n")?.host, "sourcehut");
  assert.equal(parseRepo("https://invent.kde.org/a/b"), null);
  assert.equal(parseRepo("https://invent.kde.org/a/b", true)?.host, "other");
  assert.equal(parseRepo("https://github.com/o/n%23x"), null);
});

test("parseStoreLink reads package ids from the three store forms and rejects bad ids", () => {
  assert.deepEqual(parseStoreLink("https://f-droid.org/packages/org.a.b/"), { type: "fdroid", pkg: "org.a.b" });
  assert.deepEqual(parseStoreLink("https://f-droid.org/en/packages/org.a.b"), { type: "fdroid", pkg: "org.a.b" });
  assert.deepEqual(parseStoreLink("https://apt.izzysoft.de/packages/org.a.b"), { type: "izzy", pkg: "org.a.b" });
  assert.deepEqual(parseStoreLink("https://apt.izzysoft.de/fdroid/index/apk/org.a.b"), { type: "izzy", pkg: "org.a.b" });
  assert.deepEqual(parseStoreLink("https://play.google.com/store/apps/details?id=org.a.b&hl=en"), { type: "play", pkg: "org.a.b" });
  assert.equal(parseStoreLink("https://play.google.com/store/apps/details?id=org.a;end"), null);
  assert.equal(parseStoreLink("https://f-droid.org/packages/org.a.2048"), null);
  assert.equal(parseStoreLink("https://f-droid.org/packages/single"), null);
  assert.equal(parseStoreLink("https://example.org/packages/org.a.b"), null);
});

test("variantOf recognizes suffix builds but not a bare two-segment id", () => {
  assert.deepEqual(variantOf("org.app.fdroid"), { base: "org.app", label: "F-Droid build" });
  assert.deepEqual(variantOf("org.app.beta"), { base: "org.app", label: "Beta" });
  assert.deepEqual(variantOf("app.simple.inure.play"), { base: "app.simple.inure", label: "Play Store build" });
  assert.equal(variantOf("org.app.lite"), null);
  assert.equal(variantOf("org.app"), null);
  assert.equal(variantOf("app.fdroid"), null);
});

test("parseFirstSeen keeps the earliest commit per normalized URL", () => {
  const log = [
    "",
    "2020-01-02T10:00:00+02:00\n\ndiff\n+* [**A**](https://github.com/o/a)\n+* [B](http://example.org/b/)",
    "2021-05-01T00:00:00Z\n\n+* [A again](https://GitHub.com/o/a)\n-* [B](http://example.org/b/)",
  ].join("\0");
  const seen = parseFirstSeen(log);
  assert.equal(seen.get("https://github.com/o/a"), "2020-01-02");
  assert.equal(seen.get("https://example.org/b"), "2020-01-02");
  assert.equal(seen.size, 2);
});

test("classifyLicense reads loose license strings", () => {
  assert.equal(classifyLicense("GPL-3.0-or-later"), "foss");
  assert.equal(classifyLicense("Apache 2.0"), "foss");
  assert.equal(classifyLicense("Apache-2.0 OR GPL-3.0-or-later"), "foss");
  assert.equal(classifyLicense("Proprietary"), "nonfree");
  assert.equal(classifyLicense("PolyForm-Noncommercial-1.0.0"), "nonfree");
  assert.equal(classifyLicense("Modified MPL-2.0"), "unknown");
  assert.equal(classifyLicense("MIT AND Proprietary"), "nonfree");
});

const spdx = loadSpdxList();

test("the pinned SPDX list is 3.29.0", () => {
  assert.equal(spdx.licenseListVersion, "3.29.0");
});

test("parseSpdx handles precedence, parentheses, WITH and +", () => {
  assert.deepEqual(parseSpdx("MIT OR Apache-2.0 AND BSD-3-Clause"), {
    type: "or",
    left: { type: "license", id: "MIT", plus: false, exception: null },
    right: {
      type: "and",
      left: { type: "license", id: "Apache-2.0", plus: false, exception: null },
      right: { type: "license", id: "BSD-3-Clause", plus: false, exception: null },
    },
  });
  assert.deepEqual(parseSpdx("GPL-2.0+ WITH Classpath-exception-2.0"), { type: "license", id: "GPL-2.0", plus: true, exception: "Classpath-exception-2.0" });
  assert.throws(() => parseSpdx("(MIT"));
  assert.throws(() => parseSpdx("MIT OR"));
  assert.throws(() => parseSpdx("MIT; rm -rf"));
});

test("deprecated ids map to their current form", () => {
  assert.equal(currentId("GPL-3.0", false, spdx), "GPL-3.0-only");
  assert.equal(currentId("GPL-3.0", true, spdx), "GPL-3.0-or-later");
  assert.equal(currentId("mit", false, spdx), "MIT");
  assert.equal(currentId("Nonexistent-1.0", false, spdx), null);
});

test("the license gate passes free licenses and rejects everything rule 3 names", () => {
  assert.equal(licenseGate("GPL-3.0-or-later", spdx).ok, true);
  assert.equal(licenseGate("GPL-3.0", spdx).ok, true);
  assert.deepEqual(licenseGate("GPL-3.0", spdx).ids, ["GPL-3.0-only"]);
  assert.equal(licenseGate("CC0-1.0", spdx).ok, true);
  assert.equal(licenseGate("WTFPL", spdx).ok, true);
  assert.equal(licenseGate("GPL-2.0-only WITH Classpath-exception-2.0", spdx).ok, true);
  assert.equal(licenseGate("MIT OR CC-BY-NC-4.0", spdx).ok, false);
  assert.equal(licenseGate("LicenseRef-Proprietary", spdx).ok, false);
  assert.equal(licenseGate("PublicDomain", spdx).ok, false);
  assert.equal(licenseGate("GPL-2.0-only WITH Made-up-exception", spdx).ok, false);
  assert.equal(licenseGate("Proprietary", spdx).ok, false);
  assert.equal(licenseGate(null, spdx).ok, false);
});

test("retry retries transient failures with backoff and gives up on client errors", async () => {
  let calls = 0;
  const delays: number[] = [];
  const value = await retry(
    () => {
      calls++;
      if (calls < 3) throw new HttpError("u", 503);
      return "ok";
    },
    { sleep: async (ms) => void delays.push(ms), baseDelayMs: 10, retryable: isTransient },
  );
  assert.equal(value, "ok");
  assert.deepEqual(delays, [10, 20]);
  calls = 0;
  await assert.rejects(
    retry(
      () => {
        calls++;
        throw new HttpError("u", 404);
      },
      { sleep: async () => {}, retryable: isTransient },
    ),
  );
  assert.equal(calls, 1);
});
