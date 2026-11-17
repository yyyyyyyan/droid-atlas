/**
 * Download figures as the sources publish them (`DownloadStat` in the
 * schema). Each origin counts something different over its own period, so
 * nothing here adds or compares figures across origins.
 *
 * - F-Droid publishes weekly hit counts per URL path for each of its own
 *   servers (https://fdroid.gitlab.io/metrics/, from the `fdroid/metrics`
 *   project). A hit is any request answered without an error, partial ones
 *   included; a path with fewer than 100 hits on a server in a week is left
 *   out of that server's file. The figure is the sum, over the front-end
 *   download servers and the last four weeks they cover completely, of the
 *   hits on the app's APK files.
 * - IzzyOnDroid publishes per-day download counts per package, collected from
 *   the logs of its servers that report statistics
 *   (https://dlstats.izzyondroid.org/). The figure is the sum over the last 30
 *   days published.
 * - GitHub counts downloads of each release asset. The figure is the sum over
 *   the latest release's `.apk` assets, from the day it was published to the
 *   day the facts were fetched.
 *
 * Published files are cached; a source that cannot be reached leaves the
 * cached figures in place, or none, and never fails the build.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DownloadSource, DownloadStat } from "../../schema/catalog.ts";
import { HttpError, isTransient, retry } from "../lib/retry.ts";

export interface DownloadFigures {
  source: DownloadSource;
  /** Package id → figure. Packages the source publishes nothing for are absent. */
  byPackage: Map<string, DownloadStat>;
  /** First and last day the figures cover. */
  period: { from: string; to: string };
}

export interface DownloadOptions {
  cacheDir: string;
  offline: boolean;
  now: () => Date;
  fetchImpl?: typeof fetch;
  log: (text: string) => void;
}

const USER_AGENT = "droid-atlas-pipeline";
type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  return retry(
    async () => {
      const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT } });
      if (!response.ok) throw new HttpError(url, response.status);
      return response.text();
    },
    { retryable: isTransient, attempts: 3, baseDelayMs: 1500 },
  );
}

/**
 * A published file, from the cache when the cached copy is `final` (the
 * publisher will not change it again), otherwise fetched and cached; the
 * cached copy when the fetch fails. Null when neither exists.
 */
async function published(url: string, cachePath: string, final: (text: string) => boolean, options: DownloadOptions): Promise<{ text: string; retrieved: string } | null> {
  const stamp = `${cachePath}.retrieved`;
  const cached = existsSync(cachePath) ? { text: readFileSync(cachePath, "utf8"), retrieved: existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "" } : null;
  if (options.offline || (cached && final(cached.text))) return cached;
  try {
    const text = await fetchText(url, options.fetchImpl ?? fetch);
    const retrieved = options.now().toISOString();
    writeFileSync(cachePath, text);
    writeFileSync(stamp, retrieved);
    return { text, retrieved };
  } catch (error) {
    options.log(`downloads: ${url}: ${error instanceof Error ? error.message : String(error)}${cached ? "; using the cached copy" : ""}`);
    return cached;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}


export const FDROID_METRICS = "https://fdroid.gitlab.io/metrics/";
/** F-Droid's own front-end download servers, whose weekly files the figure sums. */
export const FDROID_SERVERS = ["http01.fdroid.net", "http02.fdroid.net", "http03.fdroid.net", "http04.fdroid.net"] as const;
/** Weeks the F-Droid figure covers. */
export const FDROID_WEEKS = 4;
/** A week counts as complete when its processed logs span at least this many days. */
const COMPLETE_WEEK_DAYS = 5.5;
const APK_PATH_RE = /^\/(?:repo|archive)\/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)_\d{1,12}\.apk$/;

/** The package an F-Droid download path is an APK of, or null. */
export function fdroidApkPackage(path: string): string | null {
  return APK_PATH_RE.exec(path)?.[1] ?? null;
}

export interface FdroidWeek {
  week: string;
  from: string;
  to: string;
  complete: boolean;
  /** Package → hits on its APK files on this server in this week. */
  hits: Map<string, number>;
}

/** One server's weekly file. */
export function readFdroidWeek(week: string, json: unknown): FdroidWeek | null {
  const root = object(json);
  const first = typeof root?.["firstProcessedDate"] === "string" ? Date.parse(root["firstProcessedDate"]) : NaN;
  const last = typeof root?.["lastProcessedDate"] === "string" ? Date.parse(root["lastProcessedDate"]) : NaN;
  const paths = object(root?.["paths"]);
  if (!root || !paths || !Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
  const hits = new Map<string, number>();
  for (const [path, value] of Object.entries(paths)) {
    const pkg = fdroidApkPackage(path);
    const n = count(object(value)?.["hits"]);
    if (pkg && n) hits.set(pkg, (hits.get(pkg) ?? 0) + n);
  }
  return {
    week,
    from: new Date(first).toISOString().slice(0, 10),
    to: new Date(last).toISOString().slice(0, 10),
    complete: (last - first) / 86_400_000 >= COMPLETE_WEEK_DAYS,
    hits,
  };
}

/** Sums the weeks every listed server covers completely, the latest `weeks` of them. */
export function combineFdroidWeeks(byServer: Map<string, FdroidWeek[]>, weeks = FDROID_WEEKS): { period: { from: string; to: string }; hits: Map<string, number>; weeks: string[] } | null {
  const servers = [...byServer.values()].filter((list) => list.length > 0);
  if (!servers.length) return null;
  const completeIn = servers.map((list) => new Set(list.filter((w) => w.complete).map((w) => w.week)));
  const common = [...(completeIn[0] ?? [])].filter((week) => completeIn.every((set) => set.has(week))).sort().slice(-weeks);
  if (!common.length) return null;
  const hits = new Map<string, number>();
  let from = "9999-99-99";
  let to = "0000-00-00";
  for (const list of servers) {
    for (const week of list) {
      if (!common.includes(week.week)) continue;
      if (week.from < from) from = week.from;
      if (week.to > to) to = week.to;
      for (const [pkg, n] of week.hits) hits.set(pkg, (hits.get(pkg) ?? 0) + n);
    }
  }
  return { period: { from, to }, hits, weeks: common };
}

export async function fdroidDownloads(options: DownloadOptions): Promise<DownloadFigures | null> {
  const dir = join(options.cacheDir, "fdroid-metrics");
  mkdirSync(dir, { recursive: true });
  const byServer = new Map<string, FdroidWeek[]>();
  let retrieved = "";
  for (const server of FDROID_SERVERS) {
    const index = await published(`${FDROID_METRICS}${server}/index.json`, join(dir, `${server}.index.json`), () => false, options);
    const names = Array.isArray(parseJson(index?.text ?? "")) ? (parseJson(index?.text ?? "") as unknown[]) : [];
    const weeks = names
      .filter((n): n is string => typeof n === "string" && /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .sort()
      .slice(-(FDROID_WEEKS + 2));
    const latest = weeks.at(-1);
    const read: FdroidWeek[] = [];
    for (const name of weeks) {
      const complete = (text: string): boolean => readFdroidWeek(name.slice(0, 10), parseJson(text))?.complete === true;
      const file = await published(`${FDROID_METRICS}${server}/${name}`, join(dir, `${server}.${name}`), (text) => name !== latest && complete(text), options);
      const week = file ? readFdroidWeek(name.slice(0, 10), parseJson(file.text)) : null;
      if (week) read.push(week);
      if (file && file.retrieved > retrieved) retrieved = file.retrieved;
    }
    if (read.length) byServer.set(server, read);
    const kept = new Set(weeks.map((name) => `${server}.${name}`));
    for (const file of readdirSync(dir)) {
      const week = /^(.+)\.(\d{4}-\d{2}-\d{2}\.json)(\.retrieved)?$/.exec(file);
      if (week?.[1] === server && !kept.has(`${server}.${week[2]}`)) rmSync(join(dir, file), { force: true });
    }
  }
  const recent = new Map([...byServer].filter(([, weeks]) => weeks.some((w) => w.complete && Date.parse(w.to) > options.now().getTime() - 365 * 86_400_000)));
  const combined = combineFdroidWeeks(recent);
  if (!combined) return null;
  const byPackage = new Map<string, DownloadStat>();
  for (const [pkg, n] of combined.hits) byPackage.set(pkg, { origin: "fdroid", count: n, from: combined.period.from, to: combined.period.to });
  options.log(`downloads: F-Droid weeks ${combined.weeks.join(", ")} on ${[...recent.keys()].join(", ")}`);
  return {
    source: { origin: "fdroid", name: "F-Droid Metrics", url: FDROID_METRICS, license: null, retrieved: retrieved || options.now().toISOString(), newest: combined.period.to },
    byPackage,
    period: combined.period,
  };
}


export const IZZY_STATS = "https://dlstats.izzyondroid.org/iod-stats-collector/stats/basic/monthly-in-days/";
/** Days the IzzyOnDroid figure covers. */
export const IZZY_DAYS = 30;

/** Sums the last `days` calendar days ending on the last day published; null when fewer than `days - 2` of them are present. */
export function izzyWindow(byDay: Map<string, Map<string, number>>, days = IZZY_DAYS): { period: { from: string; to: string }; counts: Map<string, number> } | null {
  const dates = [...byDay.keys()].filter((d) => DATE_RE.test(d)).sort();
  const to = dates.at(-1);
  if (!to) return null;
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const inside = dates.filter((d) => d >= from && d <= to);
  if (inside.length < days - 2) return null;
  const counts = new Map<string, number>();
  for (const date of inside) for (const [pkg, n] of byDay.get(date) ?? []) counts.set(pkg, (counts.get(pkg) ?? 0) + n);
  return { period: { from, to }, counts };
}

/** One month's file: `{ "<date>": { "<package>": <count> } }`. */
export function readIzzyMonth(json: unknown, into: Map<string, Map<string, number>>): void {
  for (const [date, value] of Object.entries(object(json) ?? {})) {
    if (!DATE_RE.test(date)) continue;
    const day = new Map<string, number>();
    for (const [pkg, n] of Object.entries(object(value) ?? {})) if (PACKAGE_RE.test(pkg) && count(n)) day.set(pkg, count(n));
    into.set(date, day);
  }
}

export async function izzyDownloads(options: DownloadOptions): Promise<DownloadFigures | null> {
  const dir = join(options.cacheDir, "izzy-dlstats");
  mkdirSync(dir, { recursive: true });
  const now = options.now();
  const months = [0, 1, 2].map((back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7));
  const byDay = new Map<string, Map<string, number>>();
  let retrieved = "";
  for (const [i, month] of months.entries()) {
    const file = await published(`${IZZY_STATS}${month}.json`, join(dir, `${month}.json`), () => i >= 2, options);
    if (!file) continue;
    readIzzyMonth(parseJson(file.text), byDay);
    if (file.retrieved > retrieved) retrieved = file.retrieved;
  }
  const window = izzyWindow(byDay);
  if (!window) return null;
  const byPackage = new Map<string, DownloadStat>();
  for (const [pkg, n] of window.counts) byPackage.set(pkg, { origin: "izzy", count: n, from: window.period.from, to: window.period.to });
  return {
    source: { origin: "izzy", name: "IzzyOnDroid download statistics", url: "https://dlstats.izzyondroid.org/", license: null, retrieved: retrieved || now.toISOString(), newest: window.period.to },
    byPackage,
    period: window.period,
  };
}


/** The latest release's APK downloads as a figure, or null when there are none. */
export function githubFigure(release: { publishedAt: string; apkDownloads: number } | null, fetchedAt: string): DownloadStat | null {
  if (!release || release.apkDownloads < 1 || !Number.isFinite(Date.parse(release.publishedAt)) || !Number.isFinite(Date.parse(fetchedAt))) return null;
  const from = release.publishedAt.slice(0, 10);
  const to = fetchedAt.slice(0, 10);
  return from <= to ? { origin: "github", count: release.apkDownloads, from, to } : null;
}

export const GITHUB_DOWNLOAD_SOURCE = (retrieved: string): DownloadSource => ({ origin: "github", name: "GitHub release assets", url: "https://docs.github.com/en/rest/releases/assets", license: null, retrieved, newest: null });

/** Days after which a publisher's newest figures are reported as stale: the build still ships them, with their dates. */
export const STALE_FIGURES_DAYS = 120;

/** Whole days from the last day a source's newest figures count to the build's date, or null for running totals. */
export function figuresAgeDays(source: Pick<DownloadSource, "newest">, generatedAt: string): number | null {
  if (source.newest === null) return null;
  return Math.max(0, Math.floor((Date.parse(generatedAt.slice(0, 10)) - Date.parse(source.newest)) / 86_400_000));
}
