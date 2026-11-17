/**
 * Contact sheets for reviewing self-hosted icons by eye: labeled grids of a
 * build's icons, one series per source rule, written as PNG files to a
 * directory outside the repository.
 *
 *   node pipeline/scripts/contact-sheets.ts --data <data dir> --out <dir> [--rules repo-launcher,readme-logo] [--apps <file of app ids>] [--size large]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import type { IconRecord, IconsPart } from "../../schema/parts.ts";

const COLUMNS = 8;
const ROWS = 6;
const CELL = 180;
const ICON = 128;
const LABEL = 44;

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

async function sheet(records: IconRecord[], dataDir: string, title: string, large: boolean): Promise<Buffer> {
  const width = COLUMNS * CELL;
  const height = 40 + ROWS * (CELL + LABEL);
  const tiles: OverlayOptions[] = [];
  const labels: string[] = [`<text x="12" y="28" font-size="20" font-family="sans-serif" font-weight="bold">${escapeXml(title)}</text>`];
  for (const [i, record] of records.entries()) {
    const x = (i % COLUMNS) * CELL;
    const y = 40 + Math.floor(i / COLUMNS) * (CELL + LABEL);
    const icon = await sharp(readFileSync(join(dataDir, large ? record.fileLarge : record.file))).resize(ICON, ICON).png().toBuffer();
    tiles.push({ input: icon, left: x + (CELL - ICON) / 2, top: y + 16 });
    labels.push(`<rect x="${x + 4}" y="${y + 4}" width="${CELL - 8}" height="${CELL + LABEL - 8}" fill="none" stroke="#ccc"/>`);
    labels.push(`<text x="${x + CELL / 2}" y="${y + CELL - 14}" font-size="13" text-anchor="middle" font-family="sans-serif">${escapeXml(clip(record.name, 24))}</text>`);
    labels.push(`<text x="${x + CELL / 2}" y="${y + CELL + 4}" font-size="11" text-anchor="middle" font-family="monospace" fill="#555">${escapeXml(clip(record.app, 28))}</text>`);
    labels.push(`<text x="${x + CELL / 2}" y="${y + CELL + 20}" font-size="10" text-anchor="middle" font-family="sans-serif" fill="#888">${escapeXml(clip(new URL(record.original.url).hostname, 30))}</text>`);
  }
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels.join("")}</svg>`);
  const checker = await sharp({ create: { width, height, channels: 4, background: "#f4f0e8" } }).png().toBuffer();
  return sharp(checker).composite([...tiles, { input: overlay, left: 0, top: 0 }]).png().toBuffer();
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { data: { type: "string" }, out: { type: "string" }, rules: { type: "string" }, apps: { type: "string" }, size: { type: "string", default: "list" } } });
  if (!values.data || !values.out) throw new Error("--data and --out are required");
  const version = JSON.parse(readFileSync(join(values.data, "version.json"), "utf8")) as { manifest: string };
  const dir = join(values.data, version.manifest.replace(/manifest\.json$/, ""));
  const part = JSON.parse(readFileSync(join(dir, "icons.json"), "utf8")) as IconsPart;
  const wanted = values.rules ? new Set(values.rules.split(",")) : null;
  const apps = values.apps ? new Set(readFileSync(values.apps, "utf8").split(/\s+/).filter(Boolean)) : null;
  mkdirSync(values.out, { recursive: true });
  const byRule = new Map<string, IconRecord[]>();
  for (const record of part.icons) {
    if ((wanted && !wanted.has(record.rule)) || (apps && !apps.has(record.app))) continue;
    byRule.set(record.rule, [...(byRule.get(record.rule) ?? []), record]);
  }
  const perSheet = COLUMNS * ROWS;
  let written = 0;
  for (const [rule, records] of [...byRule].sort(([a], [b]) => (a < b ? -1 : 1))) {
    records.sort((a, b) => a.name.localeCompare(b.name));
    for (let start = 0; start < records.length; start += perSheet) {
      const n = start / perSheet + 1;
      const title = `${rule} — ${start + 1}–${Math.min(records.length, start + perSheet)} of ${records.length}`;
      const png = await sheet(records.slice(start, start + perSheet), values.data, title, values.size === "large");
      writeFileSync(join(values.out, `${rule}-${String(n).padStart(2, "0")}.png`), png);
      written++;
    }
  }
  process.stdout.write(`wrote ${written} sheets to ${values.out}\n`);
}

await main();
