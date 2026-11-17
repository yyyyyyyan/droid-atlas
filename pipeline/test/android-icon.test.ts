/** Composing adaptive launcher icons from a repository's XML resources. */
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { androidColor, composeAdaptiveIcon, findResource, parseXml } from "../android-icon.ts";
import type { TreeEntry } from "../icon-sources.ts";

const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>`;

/** A 108 dp foreground: a red square over the centre 36 dp. */
const FOREGROUND = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
  <!-- comment -->
  <group android:translateX="0"><path android:fillColor="@color/brand" android:pathData="M36,36h36v36h-36z"/></group>
</vector>`;

const COLORS = `<resources><color name="ic_launcher_background">#FF0000FF</color><color name="brand">@color/red</color><color name="red">#F00</color></resources>`;

function world(files: Record<string, string>): { tree: TreeEntry[]; read: (path: string) => Promise<Uint8Array | null> } {
  const tree = Object.keys(files).map((path) => ({ path, sha: "0".repeat(40) }));
  return { tree, read: async (path) => (path in files ? new TextEncoder().encode(files[path]) : null) };
}

async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i] ?? -1, data[i + 1] ?? -1, data[i + 2] ?? -1, data[i + 3] ?? -1];
}

test("an adaptive icon of a color and a vector is composed to the visible 72 dp, colors resolved through references", async () => {
  const { tree, read } = world({
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": ADAPTIVE,
    "app/src/main/res/drawable/ic_launcher_foreground.xml": FOREGROUND,
    "app/src/main/res/values/colors.xml": COLORS,
    "app/src/main/res/values/strings.xml": "<resources><string name=\"a\">x</string></resources>",
  });
  const used = new Map<string, TreeEntry>();
  const png = await composeAdaptiveIcon({ tree, module: "app", read }, "mipmap", "ic_launcher", used);
  assert.ok(png);
  const meta = await sharp(png).metadata();
  assert.deepEqual([meta.width, meta.height], [288, 288]);
  assert.deepEqual(await pixel(png, 144, 144), [255, 0, 0, 255], "the foreground at the centre");
  assert.deepEqual(await pixel(png, 4, 4), [0, 0, 255, 255], "the background at the corner");
  assert.deepEqual([...used.keys()].sort(), [
    "app/src/main/res/drawable/ic_launcher_foreground.xml",
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    "app/src/main/res/values/colors.xml",
    "app/src/main/res/values/strings.xml",
  ]);
});

test("anything not understood makes the icon unavailable rather than drawn wrong", async () => {
  const base = { "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": ADAPTIVE, "app/src/main/res/values/colors.xml": COLORS };
  const cases = [
    FOREGROUND.replace("@color/brand", "?attr/colorPrimary"),
    FOREGROUND.replace("<path", '<path android:trimPathEnd="0.5"'),
    FOREGROUND.replace("M36,36h36v36h-36z", 'M36,36"/><script/><path d="z'),
    `<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"/>`,
    FOREGROUND.replace("<vector", '<vector android:tint="?attr/colorControlNormal"'),
    FOREGROUND.replace('android:fillColor="@color/brand"', 'android:fillColor="@color/missing"'),
  ];
  for (const foreground of cases) {
    const { tree, read } = world({ ...base, "app/src/main/res/drawable/ic_launcher_foreground.xml": foreground });
    assert.equal(await composeAdaptiveIcon({ tree, module: "app", read }, "mipmap", "ic_launcher", new Map()), null, foreground.slice(0, 160));
  }
});

test("XML: no document types or entities, no unbalanced tags", () => {
  assert.equal(parseXml(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><a>&e;</a>`), null);
  assert.equal(parseXml(`<a><b></a>`), null);
  assert.equal(parseXml(`<a>1 < 2</a>`), null);
  assert.deepEqual(parseXml(`<a x="1 &amp; 2"><b/>t&lt;</a>`), { name: "a", attrs: { x: "1 & 2" }, children: [{ name: "b", attrs: {}, children: [], text: "" }], text: "t<" });
});

test("colors: Android's four hex forms", () => {
  assert.deepEqual(androidColor("#f00"), [255, 0, 0, 255]);
  assert.deepEqual(androidColor("#8f00"), [255, 0, 0, 136]);
  assert.deepEqual(androidColor("#00ff00"), [0, 255, 0, 255]);
  assert.deepEqual(androidColor("#800000ff"), [0, 0, 255, 128]);
  assert.equal(androidColor("red"), null);
  assert.equal(androidColor("#12345"), null);
});

test("resources: main before flavors, densest bitmap, night and hostile paths ignored", () => {
  const tree = [
    "app/src/foss/res/mipmap-xxxhdpi/ic_launcher.png",
    "app/src/main/res/mipmap-hdpi/ic_launcher.png",
    "app/src/main/res/mipmap-xxhdpi/ic_launcher.png",
    "app/src/main/res/mipmap-night-xxxhdpi/ic_launcher.png",
    "app/src/main/../../evil/res/mipmap-xxxhdpi/ic_launcher.png",
  ].map((path) => ({ path, sha: "0".repeat(40) }));
  assert.equal(findResource(tree, "app", "mipmap", "ic_launcher")?.path, "app/src/main/res/mipmap-xxhdpi/ic_launcher.png");
  assert.equal(findResource(tree, "app", "mipmap", "ic_launcher|x"), null);
  assert.equal(findResource(tree, "app", "raw", "ic_launcher"), null);
});

test("shape backgrounds: a solid rectangle and a linear gradient at a multiple of 45 degrees; anything else is refused", async () => {
  const adaptive = ADAPTIVE.replace("@color/ic_launcher_background", "@drawable/ic_launcher_background");
  const draw = async (background: string): Promise<Buffer | null> => {
    const { tree, read } = world({
      "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": adaptive,
      "app/src/main/res/drawable/ic_launcher_foreground.xml": FOREGROUND,
      "app/src/main/res/drawable/ic_launcher_background.xml": background,
      "app/src/main/res/values/colors.xml": COLORS,
    });
    return composeAdaptiveIcon({ tree, module: "app", read }, "mipmap", "ic_launcher", new Map());
  };
  const ns = 'xmlns:android="http://schemas.android.com/apk/res/android"';
  const solid = await draw(`<shape ${ns}><solid android:color="#00FF00"/></shape>`);
  assert.ok(solid);
  assert.deepEqual(await pixel(solid, 4, 4), [0, 255, 0, 255]);
  const upward = await draw(`<shape ${ns} android:shape="rectangle"><gradient android:angle="90" android:startColor="#000000" android:endColor="#FFFFFF"/></shape>`);
  assert.ok(upward);
  const [bottom] = await pixel(upward, 144, 284);
  const [top] = await pixel(upward, 144, 4);
  assert.ok((top ?? 0) > 150 && (bottom ?? 255) < 105, `angle 90 runs from the bottom up: top ${top}, bottom ${bottom}`);
  for (const refused of [
    `<shape ${ns} android:shape="oval"><solid android:color="#00FF00"/></shape>`,
    `<shape ${ns}><solid android:color="#00FF00"/><corners android:radius="8dp"/></shape>`,
    `<shape ${ns}><gradient android:type="radial" android:startColor="#000" android:endColor="#fff"/></shape>`,
    `<shape ${ns}><gradient android:angle="30" android:startColor="#000" android:endColor="#fff"/></shape>`,
    `<shape ${ns}><gradient android:startColor="#000"/></shape>`,
  ]) {
    assert.equal(await draw(refused), null, refused);
  }
});

test("a literal color tint paints the drawn shape in that color (src_in); another tint mode is refused", async () => {
  const draw = async (foreground: string): Promise<Buffer | null> => {
    const { tree, read } = world({
      "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": ADAPTIVE,
      "app/src/main/res/drawable/ic_launcher_foreground.xml": foreground,
      "app/src/main/res/values/colors.xml": COLORS,
    });
    return composeAdaptiveIcon({ tree, module: "app", read }, "mipmap", "ic_launcher", new Map());
  };
  const tinted = await draw(FOREGROUND.replace("<vector", '<vector android:tint="#FFFFFF"'));
  assert.ok(tinted);
  assert.deepEqual(await pixel(tinted, 144, 144), [255, 255, 255, 255], "the red square drawn white");
  assert.deepEqual(await pixel(tinted, 4, 4), [0, 0, 255, 255], "the background is not tinted");
  assert.equal(await draw(FOREGROUND.replace("<vector", '<vector android:tint="#FFFFFF" android:tintMode="multiply"')), null);
});
