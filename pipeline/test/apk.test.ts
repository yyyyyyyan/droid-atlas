import assert from "node:assert/strict";
import { test } from "node:test";
import { EVIDENCE_LEVELS } from "../../schema/catalog.ts";
import { AxmlError, parseAxml } from "../apk/axml.ts";
import { HttpReadError, openPackage, packageHost } from "../apk/http.ts";
import { ManifestError, readManifest } from "../apk/manifest.ts";
import { PackageReadError, readPackage } from "../apk/read.ts";
import { findEntry, readDirectory, readEntry, type RangeSource, ZipError } from "../apk/zip.ts";
import { buildZip, el, encodeAxml, rangeServer, type FakeElement, type ZipFile } from "./apk-fixtures.ts";

const PKG = "org.example.tiles";
const FDROID = "https://f-droid.org/repo/org.example.tiles_7.apk";
const GITHUB = "https://github.com/example/tiles/releases/download/v1.0/tiles-1.0.apk";
const GITHUB_ASSET = "https://release-assets.githubusercontent.com/signed/tiles-1.0.apk";

function filter(actions: string[], categories: string[] = [], data: Record<string, string | { ref: number }>[] = []): FakeElement {
  return el("intent-filter", {}, [
    ...actions.map((name) => el("action", { name })),
    ...categories.map((name) => el("category", { name })),
    ...data.map((attrs) => el("data", attrs)),
  ]);
}

/** An invented manifest that declares one of everything the reader looks for. */
function sampleManifest(): FakeElement {
  return el("manifest", { "@package": PKG, versionCode: 7, versionName: "1.0" }, [
    el("uses-permission", { name: "android.permission.INTERNET" }),
    el("uses-permission", { name: "moe.shizuku.manager.permission.API_V23" }),
    el("application", { label: { ref: 0x7f120001 } }, [
      el("service", { name: ".WifiTile", exported: true, permission: "android.permission.BIND_QUICK_SETTINGS_TILE", label: { ref: 0x7f120002 } }, [
        filter(["android.service.quicksettings.action.QS_TILE"]),
      ]),
      el("activity", { name: "EditActivity", exported: true }, [filter(["com.twofortyfouram.locale.intent.action.EDIT_SETTING"])]),
      el("receiver", { name: "org.example.tiles.FireReceiver", exported: true }, [
        filter(["com.twofortyfouram.locale.intent.action.FIRE_SETTING"]),
      ]),
      el("activity", { name: ".ShareActivity", exported: true }, [
        filter(["android.intent.action.SEND"], ["android.intent.category.DEFAULT"], [{ mimeType: "text/plain" }, { mimeType: "image/*" }]),
        filter(["android.intent.action.SEND_MULTIPLE"], [], [{ mimeType: "image/*" }]),
      ]),
      el("activity", { name: ".LinkActivity", exported: true }, [
        filter(
          ["android.intent.action.VIEW"],
          ["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"],
          [{ scheme: "https", host: "example.org" }, { scheme: "tiles" }, { host: { ref: 0x7f130005 } }],
        ),
      ]),
      el("receiver", { name: ".ApiReceiver", permission: "org.example.tiles.permission.API" }, [
        filter(["org.example.tiles.action.TOGGLE", "org.example.tiles.action.TOGGLE"]),
      ]),
      el("receiver", { name: ".PrivateReceiver", exported: false }, [filter(["org.example.tiles.action.INTERNAL"])]),
      el("receiver", { name: ".BootReceiver", exported: { ref: 0x7f050001 } }, [filter(["android.intent.action.BOOT_COMPLETED"])]),
      el("provider", { name: "rikka.shizuku.ShizukuProvider", exported: true }),
    ]),
    el("service", { name: ".OutsideApplication" }, [filter(["android.service.quicksettings.action.QS_TILE"])]),
  ]);
}

function sampleZip(manifest: Uint8Array = encodeAxml(sampleManifest()), extra: ZipFile[] = []): Uint8Array {
  return buildZip([
    { name: "classes.dex", data: new Uint8Array(4096).fill(7) },
    { name: "AndroidManifest.xml", data: manifest, localExtra: 3 },
    { name: "resources.arsc", data: new Uint8Array(2048).fill(1), method: 0 },
    ...extra,
  ]);
}

function memory(bytes: Uint8Array): RangeSource & { reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    size: bytes.length,
    reads,
    read(start: number, length: number): Promise<Uint8Array> {
      reads.push([start, length]);
      if (start < 0 || start + length > bytes.length) return Promise.reject(new Error("outside the file"));
      return Promise.resolve(bytes.slice(start, start + length));
    },
  };
}

test("the four evidence levels stay apart and in their order", () => {
  assert.deepEqual(EVIDENCE_LEVELS, ["documented", "statically-discovered", "reported", "experimentally-verified"]);
});

test("binary XML parses with UTF-16 and UTF-8 string pools alike", () => {
  for (const utf8 of [false, true]) {
    const root = parseAxml(encodeAxml(sampleManifest(), { utf8 }));
    assert.equal(root.name, "manifest");
    assert.equal(root.children.length, 4);
    const pkg = root.attributes.find((a) => a.name === "package");
    assert.deepEqual(pkg?.value, { type: "string", value: PKG });
  }
});

test("the manifest's interfaces are read with exported and permission as declared", () => {
  const facts = readManifest(parseAxml(encodeAxml(sampleManifest())));
  assert.equal(facts.package, PKG);
  assert.deepEqual(facts.version, { name: "1.0", code: 7 });
  const i = facts.interfaces;
  assert.deepEqual(i.tiles, [
    { type: "service", name: `${PKG}.WifiTile`, exported: true, permission: "android.permission.BIND_QUICK_SETTINGS_TILE" },
  ]);
  assert.deepEqual(
    i.taskerPlugin.map((t) => [t.role, t.component.name, t.component.type]),
    [
      ["action-edit", `${PKG}.EditActivity`, "activity"],
      ["action-fire", `${PKG}.FireReceiver`, "receiver"],
    ],
  );
  assert.deepEqual(
    i.shareTargets.map((s) => [s.single, s.multiple, s.mimeTypes]),
    [
      [true, false, ["text/plain", "image/*"]],
      [false, true, ["image/*"]],
    ],
  );
  assert.deepEqual(i.links, [
    {
      component: { type: "activity", name: `${PKG}.LinkActivity`, exported: true, permission: null },
      schemes: ["https", "tiles"],
      hosts: ["example.org", { unread: "resource-reference", ref: "0x7f130005" }],
      browsable: true,
    },
  ]);
  assert.deepEqual(i.actions, [
    {
      action: "org.example.tiles.action.TOGGLE",
      component: { type: "receiver", name: `${PKG}.ApiReceiver`, exported: null, permission: "org.example.tiles.permission.API" },
    },
  ]);
  assert.deepEqual(i.shizuku, { permission: true, provider: true });
});

test("a value that is a resource reference is recorded as not read, never guessed", () => {
  const manifest = el("manifest", { "@package": PKG, versionName: { ref: 0x7f140001 }, versionCode: { ref: 0x7f0a0001 } }, [
    el("application", {}, [el("receiver", { name: ".R", exported: { ref: 0x7f050001 } }, [filter(["org.example.GO"])])]),
  ]);
  const facts = readManifest(parseAxml(encodeAxml(manifest)));
  assert.deepEqual(facts.version, { name: { unread: "resource-reference", ref: "0x7f140001" }, code: null });
  assert.deepEqual(facts.interfaces.actions[0]?.component.exported, { unread: "resource-reference", ref: "0x7f050001" });
});

test("framework attributes are found by resource id when their names are obfuscated", () => {
  const plain = readManifest(parseAxml(encodeAxml(sampleManifest())));
  const obfuscated = readManifest(parseAxml(encodeAxml(sampleManifest(), { obfuscateNames: true })));
  assert.deepEqual(obfuscated, plain);
});

test("values with unexpected text or types are not kept", () => {
  const manifest = el("manifest", { "@package": PKG }, [
    el("application", {}, [
      el("activity", { name: ".A", exported: "yes" }, [
        filter(["android.intent.action.VIEW"], [], [{ scheme: "has space" }, { scheme: "<b>x</b>" }, { scheme: "ok" }]),
      ]),
      el("receiver", { name: "bad name!" }, [filter(["x".repeat(600)])]),
    ]),
  ]);
  const facts = readManifest(parseAxml(encodeAxml(manifest)));
  const link = facts.interfaces.links[0];
  assert.deepEqual(link?.component.exported, { unread: "unexpected-value" });
  assert.deepEqual(link?.schemes, [{ unread: "unexpected-value" }, "ok"]);
  assert.deepEqual(facts.interfaces.actions[0], {
    action: { unread: "unexpected-value" },
    component: { type: "receiver", name: { unread: "unexpected-value" }, exported: null, permission: null },
  });
});

test("a manifest without a valid package id is refused", () => {
  assert.throws(() => readManifest(parseAxml(encodeAxml(el("manifest", { "@package": "not a package" })))), ManifestError);
  assert.throws(() => readManifest(parseAxml(encodeAxml(el("application")))), ManifestError);
});

test("malformed binary XML fails cleanly", () => {
  const good = encodeAxml(sampleManifest());
  assert.throws(() => parseAxml(good.subarray(0, good.length - 30)), AxmlError, "truncated");
  const cut = good.slice(0, good.length - 30);
  new DataView(cut.buffer).setUint32(4, cut.length, true);
  assert.throws(() => parseAxml(cut), AxmlError, "truncated, with its size made to match");
  assert.throws(() => parseAxml(new Uint8Array(4)), AxmlError);
  assert.throws(() => parseAxml(new TextEncoder().encode("<manifest package='a.b'/>")), AxmlError, "text XML");
  const badSize = good.slice();
  new DataView(badSize.buffer).setUint32(4, good.length + 100, true);
  assert.throws(() => parseAxml(badSize), AxmlError, "document longer than its bytes");
  const badIndex = good.slice();
  const pool = new DataView(badIndex.buffer, 8);
  pool.setUint32(8, 1, true);
  assert.throws(() => parseAxml(badIndex), AxmlError, "string index outside the pool");
  const hugePool = good.slice();
  new DataView(hugePool.buffer, 8).setUint32(8, 0x7fffffff, true);
  assert.throws(() => parseAxml(hugePool), AxmlError, "string count");
});

test("binary XML limits bound nesting, element count and string length", () => {
  let deep = el("leaf");
  for (let i = 0; i < 40; i++) deep = el("n", {}, [deep]);
  assert.throws(() => parseAxml(encodeAxml(deep)), /nested deeper/);
  const wide = el("manifest", {}, Array.from({ length: 50 }, () => el("x")));
  assert.throws(() => parseAxml(encodeAxml(wide), { ...limits(), maxElements: 20 }), /more than 20 elements/);
  const long = el("manifest", { "@package": PKG }, [el("uses-permission", { name: "p".repeat(5000) })]);
  const root = parseAxml(encodeAxml(long));
  assert.deepEqual(root.children[0]?.attributes[0]?.value, { type: "string", value: null });
  assert.throws(() => parseAxml(new Uint8Array(5 * 1024 * 1024)), /document of/);
});

function limits() {
  return { maxBytes: 1 << 20, maxStrings: 1000, maxStringLength: 4096, maxElements: 1000, maxAttributesPerElement: 64, maxDepth: 32 };
}

test("the zip directory and one entry are read by range, and nothing else", async () => {
  const bytes = sampleZip();
  const source = memory(bytes);
  const directory = await readDirectory(source);
  assert.deepEqual(
    directory.entries.map((e) => e.name),
    ["classes.dex", "AndroidManifest.xml", "resources.arsc"],
  );
  const entry = findEntry(directory, "AndroidManifest.xml");
  const manifest = await readEntry(source, directory, entry);
  assert.deepEqual(new Uint8Array(manifest), encodeAxml(sampleManifest()));
  assert.equal(source.reads.length, 2, "the tail held the directory; the entry took one read");
});

test("a directory before the tail costs one more read; a large local extra field one more", async () => {
  const padded = sampleZip(undefined, [{ name: "assets/big.bin", data: new Uint8Array(100_000), method: 0 }]);
  const names = Array.from({ length: 2000 }, (_, i) => ({ name: `res/${"d".repeat(30)}${i}.xml`, data: new Uint8Array([i & 0xff]), method: 0 as const }));
  const bigDirectory = buildZip([{ name: "AndroidManifest.xml", data: encodeAxml(sampleManifest()), localExtra: 2000 }, ...names]);
  const source = memory(bigDirectory);
  const directory = await readDirectory(source);
  assert.equal(directory.entries.length, 2001);
  await readEntry(source, directory, findEntry(directory, "AndroidManifest.xml"));
  assert.equal(source.reads.length, 4);
  assert.equal((await readDirectory(memory(padded))).entries.length, 4);
});

test("truncated, oversized and malformed zips fail cleanly", async () => {
  const manifest = encodeAxml(sampleManifest());
  const fails = async (bytes: Uint8Array, pattern: RegExp, name = "AndroidManifest.xml"): Promise<void> => {
    await assert.rejects(async () => {
      const source = memory(bytes);
      const directory = await readDirectory(source);
      await readEntry(source, directory, findEntry(directory, name));
    }, (error: unknown) => error instanceof ZipError && pattern.test(error.message));
  };
  const good = sampleZip();
  await fails(good.subarray(0, good.length - 10), /no end of central directory/);
  await fails(good.subarray(0, 10), /too small/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest }], { eocd: { count: 0xffff } }), /zip64/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest }], { eocd: { disk: 1 } }), /split/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest }], { eocd: { directoryOffset: 0x7fffff00 } }), /overlaps/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest }], { eocd: { directorySize: 9 * 1024 * 1024 } }), /central directory of/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest }], { eocd: { count: 3 } }), /truncated/);
  await fails(buildZip([{ name: "classes.dex", data: manifest }]), /no AndroidManifest.xml/);
  await fails(
    buildZip([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "AndroidManifest.xml", data: manifest },
    ]),
    /2 entries named/,
  );
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest, central: { flags: 1 } }]), /encrypted/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest, central: { method: 12 } }]), /compression method 12/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest, central: { crc32: 1 } }]), /CRC-32/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest, central: { size: 10 } }]), /not the 10 stated/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest, central: { size: 5 * 1024 * 1024 } }]), /bytes uncompressed/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest, central: { compressedSize: 3 * 1024 * 1024 } }]), /bytes compressed/);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: manifest, central: { offset: 40 } }]), /bad local header|runs into/);
  const bomb = new Uint8Array(64 * 1024 * 1024);
  await fails(buildZip([{ name: "AndroidManifest.xml", data: bomb, central: { size: 1000 } }]), /does not inflate|not the 1000 stated/);
});

test("only F-Droid and GitHub release addresses are accepted", () => {
  assert.equal(packageHost(FDROID)?.host, "fdroid");
  assert.equal(packageHost(GITHUB)?.host, "github");
  for (const address of [
    "https://apt.izzysoft.de/fdroid/repo/org.example.tiles_7.apk",
    "http://f-droid.org/repo/org.example.tiles_7.apk",
    "https://f-droid.org:8443/repo/org.example.tiles_7.apk",
    "https://user@f-droid.org/repo/org.example.tiles_7.apk",
    "https://f-droid.org/repo/../index-v2.json",
    "https://f-droid.org.example.com/repo/a.apk",
    "https://github.com/example/tiles/archive/main.zip",
    "https://objects.githubusercontent.com/x/tiles.apk",
    "https://f-droid.org/repo/org.example.tiles_7.apk?x=1",
    "not a url",
  ]) {
    assert.equal(packageHost(address), null, address);
  }
});

test("a package is read end to end by explicit ranges", async () => {
  const bytes = sampleZip(undefined, [{ name: "lib/arm64-v8a/libx.so", data: new Uint8Array(300_000).fill(3), method: 0 }]);
  const server = rangeServer({ [GITHUB_ASSET]: bytes }, { redirects: { [GITHUB]: GITHUB_ASSET } });
  const reading = await readPackage(GITHUB, {
    fetch: server.fetch,
    sha256: "AB".repeat(32),
    now: () => new Date("2026-11-23T10:00:00Z"),
  });
  assert.equal(reading.evidence, "statically-discovered");
  assert.deepEqual(reading.source, { host: "github", url: GITHUB });
  assert.deepEqual(reading.file, { name: "tiles-1.0.apk", sizeBytes: bytes.length, sha256: "ab".repeat(32) });
  assert.equal(reading.readAt, "2026-11-23T10:00:00.000Z");
  assert.equal(reading.package, PKG);
  assert.equal(reading.manifest.sizeBytes, encodeAxml(sampleManifest()).length);
  assert.match(reading.manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(reading.interfaces.tiles.length, 1);
  assert.ok(server.requests.every((r) => /^bytes=\d+-\d+$/.test(r.range ?? "")), "no suffix ranges");
  assert.equal(reading.transfer.requests, server.requests.length);
  assert.equal(server.requests.length, 4, "probe and its redirect, tail, manifest");
  assert.ok(reading.transfer.bytes < bytes.length);
  assert.equal(server.requests.filter((r) => r.url === GITHUB).length, 1, "the redirect is followed once and its target reused");
});

test("addresses, hashes and servers that are not as expected stop a reading", async () => {
  const bytes = sampleZip();
  const stage = async (address: string, options: Parameters<typeof readPackage>[1], expected: PackageReadError["stage"], pattern: RegExp) => {
    await assert.rejects(readPackage(address, options), (error: unknown) => {
      return error instanceof PackageReadError && error.stage === expected && pattern.test(error.message);
    });
  };
  const neverCalled = rangeServer({});
  await stage("https://apt.izzysoft.de/fdroid/repo/org.example.tiles_7.apk", { fetch: neverCalled.fetch }, "address", /not an allowed/);
  assert.equal(neverCalled.requests.length, 0);
  await stage(FDROID, { fetch: neverCalled.fetch, sha256: "xyz" }, "address", /sha256/);
  await stage(FDROID, { fetch: rangeServer({ [FDROID]: bytes }, { ignoreRange: true }).fetch }, "http", /HTTP 200/);
  await stage(FDROID, { fetch: rangeServer({ [FDROID]: bytes }, { extraBytes: 5 }).fetch }, "http", /more than the/);
  await stage(FDROID, { fetch: rangeServer({}).fetch }, "http", /HTTP 404/);
  await stage(
    GITHUB,
    { fetch: rangeServer({ "https://evil.example/x.apk": bytes }, { redirects: { [GITHUB]: "https://evil.example/x.apk" } }).fetch },
    "http",
    /not allowed: evil.example/,
  );
  await stage(FDROID, { fetch: rangeServer({ [FDROID]: new Uint8Array(100) }).fetch }, "http", /start like a zip/);
  await stage(FDROID, { fetch: rangeServer({ [FDROID]: sampleZip(new Uint8Array(64)) }).fetch }, "manifest", /not a binary XML/);
});

test("time limits and the request budget end a reading", async () => {
  const limits = { requestTimeoutMs: 50, totalTimeoutMs: 1000, maxRequests: 10, maxBytes: 1 << 20, maxRedirects: 3, maxFileBytes: 1 << 30 };
  await assert.rejects(
    openPackage(FDROID, { fetch: rangeServer({}, { hang: true }).fetch, limits }),
    (error: unknown) => error instanceof HttpReadError && /request failed/.test(error.message),
  );
  const loop = rangeServer({}, { redirects: { [FDROID]: FDROID } });
  await assert.rejects(openPackage(FDROID, { fetch: loop.fetch, limits }), /more than 3 redirects/);
  assert.equal(loop.requests.length, 4);
  const bytes = sampleZip();
  await assert.rejects(
    readPackage(FDROID, { fetch: rangeServer({ [FDROID]: bytes }).fetch, limits: { ...limits, maxRequests: 2 } }),
    /more than 2 requests/,
  );
  await assert.rejects(
    readPackage(FDROID, { fetch: rangeServer({ [FDROID]: bytes }).fetch, limits: { ...limits, maxBytes: 1000 } }),
    /more than 1000 bytes/,
  );
  await assert.rejects(
    readPackage(FDROID, { fetch: rangeServer({ [FDROID]: bytes }).fetch, limits: { ...limits, maxFileBytes: 1000 } }),
    /file of \d+ bytes/,
  );
});
