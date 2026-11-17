import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import sharp from "sharp";
import { faviconSvg } from "../scripts/build-icons.ts";
import { PRODUCT_APP_ID, PRODUCT_NAME, PRODUCT_SHORT_NAME, THEME_COLORS } from "../src/product.ts";
import { CONTENT_SECURITY_POLICY, fillTemplate, headersFile, isShellFile, MANIFEST_ICONS, releaseBlockers, shellVersion, webManifest } from "./site-files.ts";

const app = fileURLToPath(new URL("..", import.meta.url));

/** Width and height from a PNG's header. */
function pngSize(path: string): string {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("the web app manifest", () => {
  const manifest = webManifest();

  test("its identity is fixed, and its start URL and scope are relative so it installs from any path", () => {
    expect(manifest.id).toBe(PRODUCT_APP_ID);
    expect(manifest.id).toBe("droid-atlas");
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    for (const base of ["https://atlas.example/", "https://atlas.example/some/sub/path/"]) {
      const manifestUrl = new URL("manifest.webmanifest", base);
      expect(new URL(String(manifest.start_url), manifestUrl).href).toBe(base);
      expect(new URL(String(manifest.scope), manifestUrl).href).toBe(base);
    }
  });

  test("it names the app itself as a related web app, at its own address, so a tab can tell it is installed already", () => {
    const related = manifest.related_applications as { platform: string; url: string }[];
    expect(related).toHaveLength(1);
    expect(related[0]?.platform).toBe("webapp");
    const manifestUrl = new URL("manifest.webmanifest", "https://atlas.example/sub/");
    expect(new URL(related[0]?.url ?? "", manifestUrl).href).toBe(manifestUrl.href);
    expect(manifest.prefer_related_applications ?? false).toBe(false);
  });

  test("its name and colors come from the product module", () => {
    expect(manifest).toMatchObject({ name: PRODUCT_NAME, short_name: PRODUCT_SHORT_NAME, display: "standalone", theme_color: THEME_COLORS.dark, background_color: THEME_COLORS.dark });
    expect(PRODUCT_SHORT_NAME.length).toBeLessThanOrEqual(12);
  });

  test("every icon it names exists at the size it states, with the three purposes at both sizes", () => {
    for (const icon of MANIFEST_ICONS) {
      const path = `${app}public/${icon.src}`;
      expect(existsSync(path), icon.src).toBe(true);
      expect(pngSize(path), icon.src).toBe(icon.sizes);
    }
    for (const purpose of ["any", "maskable", "monochrome"]) {
      expect(MANIFEST_ICONS.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    }
  });

  test("its shortcuts stay inside the scope", () => {
    const shortcuts = manifest.shortcuts as { url: string }[];
    for (const shortcut of shortcuts) expect(shortcut.url.startsWith("./#/")).toBe(true);
  });
});

describe("the icon drawings", () => {
  const drawings = readdirSync(`${app}icons`).filter((name) => name.endsWith(".svg"));
  const read = (name: string): string => readFileSync(`${app}icons/${name}`, "utf8").trim();

  test("are our own: shapes and colors only, no text, image, link or embedded data", () => {
    expect(drawings).toEqual(expect.arrayContaining(["d1-icon.svg", "d1-maskable.svg", "d1-monochrome.svg", "d1-favicon-16.svg", "d1-favicon-24.svg", "d1-mark-dark.svg", "d1-mark-light.svg"]));
    for (const name of drawings) {
      expect(read(name), name).not.toMatch(/<(text|image|use|a|script|foreignObject)\b|href=|data:|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    }
  });

  test("the committed favicon is the 16 px fitting below 24 px, the 24 px fitting below 32 and the full drawing above, from the sources", () => {
    expect(readFileSync(`${app}public/favicon.svg`, "utf8")).toBe(faviconSvg(read("d1-icon.svg"), read("d1-favicon-24.svg"), read("d1-favicon-16.svg")));
  });

  test("the header mark carries the drawing's own paths", () => {
    const icon = readFileSync(`${app}src/ui/Icon.tsx`, "utf8");
    for (const name of ["d1-mark-dark.svg", "d1-favicon-24-bare-dark.svg"]) {
      for (const [, path] of read(name).matchAll(/ d="([^"]+)"/g)) expect(icon, name).toContain(`d="${path}"`);
    }
  });

  test("the monochrome icons have no colored pixel: every pixel that shows is white", async () => {
    for (const icon of MANIFEST_ICONS.filter((entry) => entry.purpose === "monochrome")) {
      const { data, info } = await sharp(`${app}public/${icon.src}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let colored = 0;
      for (let index = 0; index < data.length; index += info.channels) {
        const [red, green, blue, alpha] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
        if ((alpha ?? 0) > 0 && (red !== 255 || green !== 255 || blue !== 255)) colored += 1;
      }
      expect(colored, icon.src).toBe(0);
    }
  });
});

describe("the page template", () => {
  const template = readFileSync(`${app}index.html`, "utf8");

  test("spells the product's name only through placeholders", () => {
    expect(template).not.toContain(PRODUCT_NAME);
    const filled = fillTemplate(template);
    expect(filled).toContain(`<title>${PRODUCT_NAME}</title>`);
    expect(filled).not.toMatch(/%[A-Z_]+%/);
  });

  test("escapes what it fills in", () => {
    expect(fillTemplate("<title>%PRODUCT_NAME%</title>")).not.toMatch(/<title>.*[<"].*<\/title>/);
  });

  test("links the manifest and the icons by relative paths", () => {
    expect(template).toContain('<link rel="manifest" href="./manifest.webmanifest">');
    expect(template).toContain('href="./icons/apple-touch-icon.png"');
    expect(existsSync(`${app}public/icons/apple-touch-icon.png`)).toBe(true);
  });
});

describe("the _headers file", () => {
  const text = headersFile();
  const rule = (path: string): string => {
    const block = text.split("\n\n").find((part) => part.split("\n")[0] === path);
    if (!block) throw new Error(`no rule for ${path}`);
    return block;
  };

  test("sends the policy as a real header, with the one directive a meta tag cannot carry", () => {
    expect(rule("/*")).toContain(`Content-Security-Policy: ${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`);
    expect(CONTENT_SECURITY_POLICY).toBe("default-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'");
  });

  test.each(["/assets/*", "/data/c/*", "/data/icons/*"])("%s is cached for good", (path) => {
    expect(rule(path)).toContain("Cache-Control: public, max-age=31536000, immutable");
  });

  test.each(["/", "/index.html", "/data/version.json", "/sw.js", "/manifest.webmanifest"])("%s is always revalidated", (path) => {
    expect(rule(path)).toContain("Cache-Control: no-cache");
    expect(rule(path)).not.toContain("immutable");
  });

  test("no line is longer than hosts accept, and every rule's headers are indented under its path", () => {
    for (const line of text.split("\n")) expect(line.length).toBeLessThan(2000);
    for (const block of text.trim().split("\n\n")) {
      const [path, ...headers] = block.split("\n");
      expect(path?.startsWith("/")).toBe(true);
      expect(headers.length).toBeGreaterThan(0);
      for (const header of headers) expect(header).toMatch(/^ {2}[A-Za-z-]+: \S/);
    }
  });
});

describe("the shell the worker stores", () => {
  test("is the page, its assets and its icons; not the catalog, source maps, the worker itself or host files", () => {
    const files = ["index.html", "assets/index-abc.js", "assets/index-abc.js.map", "assets/font.woff2", "theme.js", "favicon.svg", "manifest.webmanifest", "icons/icon-192.png", "sw.js", "_headers", "data/version.json", "data/c/0123/atlas.json", ".DS_Store"];
    expect(files.filter(isShellFile)).toEqual(["index.html", "assets/index-abc.js", "assets/font.woff2", "theme.js", "favicon.svg", "manifest.webmanifest", "icons/icon-192.png"]);
  });

  test("its version changes with any file's content or name, and not with the order they are listed in", () => {
    const a = { path: "index.html", content: "<html>" };
    const b = { path: "assets/app.js", content: "x" };
    const version = shellVersion([a, b]);
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(shellVersion([b, a])).toBe(version);
    expect(shellVersion([a, { ...b, content: "y" }])).not.toBe(version);
    expect(shellVersion([a, { ...b, path: "assets/app2.js" }])).not.toBe(version);
    expect(shellVersion([a])).not.toBe(version);
  });
});

describe("a release build", () => {
  test("is blocked while the repository address is missing or a placeholder, and by nothing once it is real", () => {
    expect(releaseBlockers("")).toHaveLength(1);
    expect(releaseBlockers("https://repository.invalid/project")[0]).toContain("PRODUCT_REPOSITORY");
    expect(releaseBlockers("http://github.com/owner/project")).toHaveLength(1);
    expect(releaseBlockers("https://github.com/owner/project")).toEqual([]);
    expect(releaseBlockers()).toEqual([]);
  });
});
