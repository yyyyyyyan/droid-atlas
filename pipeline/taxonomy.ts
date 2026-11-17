/**
 * Droid Atlas's own taxonomy (docs/TAXONOMY.md): the regions, the categories
 * the app shows inside them, how each upstream category maps into one, and
 * how one app resolves to exactly one category.
 *
 * Presentation, not a source claim. Each listing keeps its source's own
 * category; this module only decides where Droid Atlas files the app. The
 * daily build never fails on it: an upstream category missing from
 * `MAPPING` falls back to a remainder and is reported, and so is an app that
 * arrives in a catch-all with no placement, or a placement whose app is gone.
 */
import { readFileSync } from "node:fs";
import type { Category, Region, SourceCategory } from "../schema/catalog.ts";

export const REGIONS: readonly Region[] = [
  { id: "system", name: "System & Tweaks" },
  { id: "apps", name: "Apps & Installers" },
  { id: "files", name: "Files & Sync" },
  { id: "automation", name: "Automation & Dev Tools" },
  { id: "device", name: "Device-specific" },
  { id: "privacy", name: "Privacy, Security & Network" },
  { id: "personal", name: "Personalization" },
  { id: "comms", name: "Communication" },
  { id: "media", name: "Media" },
  { id: "work", name: "Productivity" },
  { id: "world", name: "Web & World" },
  { id: "games", name: "Games" },
  { id: "guides", name: "Guides & Further Reading" },
];

function region(id: string, list: [id: string, name: string, remainder?: "remainder"][]): Category[] {
  return list.map(([slug, name, remainder]) => ({ id: slug, name, region: id, remainder: remainder === "remainder" }));
}

/**
 * Every category the app shows, in reading order within each region. Names
 * follow the rule in docs/COPY.md § Category names. A remainder holds what
 * nobody has placed in its region; a region that a catch-all or a fallback
 * leads to has exactly one.
 */
export const CATEGORIES: readonly Category[] = [
  ...region("system", [
    ["battery-power", "Battery & Power"],
    ["display-tools", "Display Tools"],
    ["quick-settings-tiles", "Quick Settings Tiles"],
    ["monitors-task-managers", "Monitors & Task Managers"],
    ["shizuku-alternatives", "Shizuku & Alternatives"],
    ["rooting-recovery", "Rooting & Recovery"],
    ["flashlights", "Flashlights"],
    ["other-system-tools", "Other System Tools", "remainder"],
  ]),
  ...region("apps", [
    ["app-stores-updaters", "App Stores & Updaters"],
    ["installers", "Installers"],
    ["app-managers", "App Managers"],
    ["app-freezers", "App Freezers"],
    ["patchers-mods", "Patchers & Mods"],
    ["backup", "Backup"],
  ]),
  ...region("files", [
    ["file-managers", "File Managers"],
    ["file-tools", "File Tools"],
    ["sharing-pc-link", "Sharing & PC Link"],
    ["cloud-sync", "Cloud & Sync"],
    ["downloaders", "Downloaders"],
  ]),
  ...region("automation", [
    ["automation-tools", "Automation Tools"],
    ["ai-agents", "AI Agents"],
    ["developer-tools", "Developer Tools", "remainder"],
    ["apk-tools", "APK Tools"],
    ["terminals-linux", "Terminals & Linux"],
    ["remote-access", "Remote Access"],
    ["smart-home-wearables", "Smart Home & Wearables"],
  ]),
  ...region("device", [
    ["samsung", "Samsung"],
    ["google-pixel", "Google Pixel"],
    ["xiaomi", "Xiaomi"],
    ["nothing-phone", "Nothing Phone"],
    ["gaming-handhelds", "Gaming Handhelds"],
    ["e-ink-tablets", "E-ink Tablets"],
    ["android-tv", "Android TV"],
    ["android-auto", "Android Auto"],
    ["other-devices", "Other Devices", "remainder"],
  ]),
  ...region("privacy", [
    ["network-tools", "Network Tools"],
    ["privacy-tools", "Privacy Tools"],
    ["passwords-2fa", "Passwords & 2FA"],
    ["vpns-proxies", "VPNs & Proxies"],
    ["firewalls", "Firewalls"],
    ["ad-blockers", "Ad Blockers"],
    ["link-tools", "Link Tools"],
    ["profiles-device-owner", "Profiles & Device Owner"],
    ["encryption", "Encryption"],
    ["safety-anti-theft", "Safety & Anti-Theft"],
  ]),
  ...region("personal", [
    ["system-ui-gestures", "System UI & Gestures"],
    ["desktop-modes", "Desktop Modes"],
    ["launchers", "Launchers"],
    ["keyboards", "Keyboards"],
    ["buttons-controllers", "Buttons & Controllers"],
    ["wallpapers", "Wallpapers"],
    ["icon-packs", "Icon Packs"],
  ]),
  ...region("comms", [
    ["messengers", "Messengers"],
    ["social-forums", "Social & Forums"],
    ["calls-contacts", "Calls & Contacts"],
    ["email", "Email"],
    ["sms-apps", "SMS Apps"],
    ["other-communication", "Other Communication Apps", "remainder"],
  ]),
  ...region("media", [
    ["music-streaming-radio", "Music Streaming & Radio"],
    ["video-streaming-clients", "Video Streaming Clients"],
    ["music-making", "Music Making"],
    ["sound-volume", "Sound & Volume"],
    ["music-players", "Music Players"],
    ["podcasts-audiobooks", "Podcasts & Audiobooks"],
    ["video-players", "Video Players"],
    ["image-tools", "Image Tools"],
    ["cameras", "Cameras"],
    ["anime-manga", "Anime & Manga"],
    ["galleries", "Galleries"],
    ["drawing-painting", "Drawing & Painting"],
    ["screen-audio-recorders", "Screen & Audio Recorders"],
    ["video-editors", "Video Editors"],
    ["movie-tv-trackers", "Movie & TV Trackers"],
    ["other-media", "Other Media Apps", "remainder"],
  ]),
  ...region("work", [
    ["notes-journals", "Notes & Journals"],
    ["ebook-document-readers", "E-book & Document Readers"],
    ["calculators-converters", "Calculators & Converters"],
    ["habits-time-tracking", "Habits & Time Tracking"],
    ["todo-planners", "To-Do & Planners"],
    ["finance", "Finance"],
    ["dictionaries", "Dictionaries"],
    ["scanners-pdf-tools", "Scanners & PDF Tools"],
    ["clocks-timers", "Clocks & Timers"],
    ["translators", "Translators"],
    ["focus-screen-time", "Focus & Screen Time"],
    ["speech-voice", "Speech & Voice"],
    ["text-editors", "Text Editors"],
    ["barcode-qr-scanners", "Barcode & QR Scanners"],
    ["calendars", "Calendars"],
    ["bookmarks-read-later", "Bookmarks & Read Later"],
    ["clipboard-tools", "Clipboard Tools"],
    ["flashcards", "Flashcards"],
    ["office-suites", "Office Suites"],
    ["other-productivity", "Other Productivity Tools", "remainder"],
  ]),
  ...region("world", [
    ["browsers", "Browsers"],
    ["maps-navigation", "Maps & Navigation"],
    ["health-sports", "Health & Sports"],
    ["weather", "Weather"],
    ["science-education", "Science & Education"],
    ["rss-readers", "RSS Readers"],
    ["religion", "Religion"],
    ["public-transit", "Public Transit"],
    ["other-apps", "Other Web & World Apps", "remainder"],
  ]),
  ...region("games", [
    ["game-tools", "Game Tools"],
    ["puzzle-games", "Puzzle Games"],
    ["board-card-games", "Board & Card Games"],
    ["educational-games", "Educational Games"],
    ["arcade-games", "Arcade Games"],
    ["strategy-games", "Strategy Games"],
    ["emulators", "Emulators"],
    ["word-games", "Word Games"],
    ["racing-sports-games", "Racing & Sports Games"],
    ["music-games", "Music Games"],
    ["other-games", "Other Games", "remainder"],
  ]),
  ...region("guides", [
    ["app-lists", "App Lists & Repositories"],
    ["tutorials-references", "Tutorials & References"],
  ]),
];

/** An upstream category too broad to say where its apps belong. Its apps are placed one by one; until then they wait in `home`'s remainder. */
export interface CatchAll {
  catchAll: true;
  /** The region whose remainder holds the apps nobody has placed. */
  home: string;
  /** Why the category is a catch-all, for docs/TAXONOMY.md and the build report. */
  why: string;
}

const catchAll = (home: string, why: string): CatchAll => ({ catchAll: true, home, why });

/**
 * Upstream category id → the Droid Atlas category it maps into, or a
 * catch-all. Keys are the sources' category ids (`<source>/<slug>`), which are
 * stable across builds; awesome-shizuku's closed-source page repeats the
 * open list's categories and maps the same way.
 */
export const MAPPING: Readonly<Record<string, string | CatchAll>> = {
  "android-foss/app-store": "app-stores-updaters",
  "android-foss/apps-ad-blocker": "ad-blockers",
  "android-foss/apps-anime-and-manga": "anime-manga",
  "android-foss/apps-automation": "automation-tools",
  "android-foss/apps-backup": "backup",
  "android-foss/apps-barcode-and-qr-code-scanner": "barcode-qr-scanners",
  "android-foss/apps-battery": "battery-power",
  "android-foss/apps-browser": "browsers",
  "android-foss/apps-calculator": "calculators-converters",
  "android-foss/apps-calendar": "calendars",
  "android-foss/apps-call-blocker-and-spam-filter": "calls-contacts",
  "android-foss/apps-camera": "cameras",
  "android-foss/apps-clock-and-time": "clocks-timers",
  "android-foss/apps-community-clients": "social-forums",
  "android-foss/apps-contacts": "calls-contacts",
  "android-foss/apps-development": "developer-tools",
  "android-foss/apps-diary": "notes-journals",
  "android-foss/apps-dialer": "calls-contacts",
  "android-foss/apps-dictionaries": "dictionaries",
  "android-foss/apps-document-and-pdf-viewer": "ebook-document-readers",
  "android-foss/apps-document-scanner-and-editor": "scanners-pdf-tools",
  "android-foss/apps-downloader-and-manager": "downloaders",
  "android-foss/apps-email-aliases": "email",
  "android-foss/apps-email-clients": "email",
  "android-foss/apps-file-encryption": "encryption",
  "android-foss/apps-file-manager": "file-managers",
  "android-foss/apps-file-sharing": "sharing-pc-link",
  "android-foss/apps-finance": "finance",
  "android-foss/apps-firewall": "firewalls",
  "android-foss/apps-flashcard": "flashcards",
  "android-foss/apps-flashlight": "flashlights",
  "android-foss/apps-graphics": "drawing-painting",
  "android-foss/apps-habit-tracker": "habits-time-tracking",
  "android-foss/apps-icon-packs": "icon-packs",
  "android-foss/apps-image-manipulation": "image-tools",
  "android-foss/apps-image-viewer-and-gallery": "galleries",
  "android-foss/apps-keyboard": "keyboards",
  "android-foss/apps-launcher-and-desktop": "launchers",
  "android-foss/apps-maps-and-navigation": "maps-navigation",
  "android-foss/apps-media-frontends": "video-streaming-clients",
  "android-foss/apps-messaging": "messengers",
  "android-foss/apps-miscellaneous": catchAll("world", "Android FOSS's own “Miscellaneous”: remote desktop, recorders, timers, wearables and more."),
  "android-foss/apps-movie-and-cinema": "movie-tv-trackers",
  "android-foss/apps-music": "music-making",
  "android-foss/apps-music-and-audio-player": "music-players",
  "android-foss/apps-music-and-radio-streaming-player": "music-streaming-radio",
  "android-foss/apps-notes": "notes-journals",
  "android-foss/apps-office": "office-suites",
  "android-foss/apps-password-and-authentication": "passwords-2fa",
  "android-foss/apps-podcast-and-audio-book-player": "podcasts-audiobooks",
  "android-foss/apps-privacy-and-security": "privacy-tools",
  "android-foss/apps-productivity": catchAll("work", "Named for the whole region: planners, a reading list and a focus app."),
  "android-foss/apps-public-transport": "public-transit",
  "android-foss/apps-religion": "religion",
  "android-foss/apps-rss-readers": "rss-readers",
  "android-foss/apps-sandboxing": "profiles-device-owner",
  "android-foss/apps-science-and-education": "science-education",
  "android-foss/apps-sms": "sms-apps",
  "android-foss/apps-sports-and-health": "health-sports",
  "android-foss/apps-synchronisation": "cloud-sync",
  "android-foss/apps-system": catchAll("system", "Anything that touches the system: app managers, network monitors, terminals, theming, device info."),
  "android-foss/apps-terminals": "terminals-linux",
  "android-foss/apps-text-editors": "text-editors",
  "android-foss/apps-text-to-speech": "speech-voice",
  "android-foss/apps-todo-lists": "todo-planners",
  "android-foss/apps-translation": "translators",
  "android-foss/apps-url-manipulation": "link-tools",
  "android-foss/apps-utilities": catchAll("system", "Android FOSS's own catch-all: a link organizer beside a VNC client, an OCR app and a counter."),
  "android-foss/apps-video-editor": "video-editors",
  "android-foss/apps-video-player": "video-players",
  "android-foss/apps-vpn": "vpns-proxies",
  "android-foss/apps-wallpapers": "wallpapers",
  "android-foss/apps-weather": "weather",
  "android-foss/games-board": "board-card-games",
  "android-foss/games-card": "board-card-games",
  "android-foss/games-educational": "educational-games",
  "android-foss/games-emulator": "emulators",
  "android-foss/games-miscellaneous": catchAll("games", "Games of every genre that fit no other heading."),
  "android-foss/games-music": "music-games",
  "android-foss/games-puzzle": "puzzle-games",
  "android-foss/games-racing": "racing-sports-games",
  "android-foss/games-retro": "arcade-games",
  "android-foss/games-strategy": "strategy-games",
  "android-foss/games-word": "word-games",
  "android-foss/rooting-and-recovery": "rooting-recovery",
  "android-foss/tools": catchAll("automation", "Desktop tools for taking APKs apart, a debloater, a site checker and Shizuku itself."),
  "android-foss/tutorials-and-guides": "tutorials-references",
  "android-foss/getting-more": "app-lists",

  "awesome-shizuku/shizuku-implementations": "shizuku-alternatives",
  "awesome-shizuku/ai-agents": "ai-agents",
  "awesome-shizuku/android-auto": "android-auto",
  "awesome-shizuku/android-tv": "android-tv",
  "awesome-shizuku/audio": "sound-volume",
  "awesome-shizuku/automation": "automation-tools",
  "awesome-shizuku/communication": catchAll("comms", "Link redirectors, call recorders, Discord mod managers, clipboard and file sharing."),
  "awesome-shizuku/customization": "system-ui-gestures",
  "awesome-shizuku/development-utilities": "developer-tools",
  "awesome-shizuku/device-owner-dpm": "profiles-device-owner",
  "awesome-shizuku/display-management": "display-tools",
  "awesome-shizuku/entertainment": catchAll("media", "A manga reader, a Spotify ad skipper, a link opener and two Bilibili exporters."),
  "awesome-shizuku/file-management": "file-managers",
  "awesome-shizuku/games": "game-tools",
  "awesome-shizuku/input-methods": "buttons-controllers",
  "awesome-shizuku/installer-and-app-stores": "app-stores-updaters",
  "awesome-shizuku/miscellaneous": catchAll("system", "awesome-shizuku's own catch-all: recorders, monitors, exploits, Linux and alarms."),
  "awesome-shizuku/network": "network-tools",
  "awesome-shizuku/patching": "patchers-mods",
  "awesome-shizuku/power-management": "battery-power",
  "awesome-shizuku/privacy": "privacy-tools",
  "awesome-shizuku/productivity": catchAll("work", "Named for the whole region: clipboard tools, focus apps, PC links and a to-do app."),
  "awesome-shizuku/quick-settings": "quick-settings-tiles",
  "awesome-shizuku/software-management": "app-managers",
  "awesome-shizuku/task-manager": "monitors-task-managers",
  "awesome-shizuku/terminals": "terminals-linux",
  "awesome-shizuku/vendor-ayn": "gaming-handhelds",
  "awesome-shizuku/vendor-google-pixel": "google-pixel",
  "awesome-shizuku/vendor-samsung-oneui": "samsung",
  "awesome-shizuku/vendor-miui": "xiaomi",
  "awesome-shizuku/vendor-nothing-phone": "nothing-phone",
  "awesome-shizuku/vendor-other": catchAll("device", "Apps for one device each: e-ink tablets, gaming handhelds, a car head unit, a headset."),
  "awesome-shizuku/closed-ai-agents": "ai-agents",
  "awesome-shizuku/closed-android-auto": "android-auto",
  "awesome-shizuku/closed-audio": "sound-volume",
  "awesome-shizuku/closed-automation": "automation-tools",
  "awesome-shizuku/closed-customization": "system-ui-gestures",
  "awesome-shizuku/closed-development-utilities": "developer-tools",
  "awesome-shizuku/closed-display-management": "display-tools",
  "awesome-shizuku/closed-file-management": "file-managers",
  "awesome-shizuku/closed-games": "game-tools",
  "awesome-shizuku/closed-input-methods": "buttons-controllers",
  "awesome-shizuku/closed-network": "network-tools",
  "awesome-shizuku/closed-power-management": "battery-power",
  "awesome-shizuku/closed-productivity": catchAll("work", "The closed-source page's “Productivity”, as on the open list."),
  "awesome-shizuku/closed-quick-settings": "quick-settings-tiles",
  "awesome-shizuku/closed-software-management": "app-managers",
  "awesome-shizuku/closed-terminals": "terminals-linux",
  "awesome-shizuku/closed-vendor-samsung-oneui": "samsung",
  "awesome-shizuku/closed-vendor-miui": "xiaomi",
  "awesome-shizuku/archived": catchAll("system", "A status, not a kind of app: anything the list no longer recommends."),
};

/** Where an upstream category missing from `MAPPING` goes: its source's fallback region, as before the taxonomy. */
function fallbackRegion(category: Pick<SourceCategory, "source" | "section">): string {
  const section = category.section ?? "";
  if (category.source === "android-foss") return section === "Games" ? "games" : "world";
  if (category.source === "awesome-shizuku" && section.includes("Vendor-specific")) return "device";
  return "system";
}

const byId = new Map(CATEGORIES.map((category) => [category.id, category]));

/** The remainder of a region. Every region a catch-all or a fallback leads to has one; the unit tests hold that. */
export function remainderOf(regionId: string): Category {
  const found = CATEGORIES.find((category) => category.region === regionId && category.remainder);
  if (!found) throw new Error(`region ${regionId} has no remainder category`);
  return found;
}

export function categoryById(id: string): Category | undefined {
  return byId.get(id);
}

/** How an upstream category entered the taxonomy. */
export type MappingKind = "mapped" | "catch-all" | "fallback";

export interface SourceCategoryMapping {
  /** The Droid Atlas category, or null for a catch-all. */
  category: string | null;
  kind: MappingKind;
  /** For a catch-all: the region its unplaced apps wait in. */
  home: string | null;
}

/** The region of a mapping: its category's, or a catch-all's home. */
export function regionOfMapping(mapping: SourceCategoryMapping): string {
  return mapping.home ?? byId.get(mapping.category ?? "")?.region ?? "";
}

/** Maps one upstream category. A category missing from the table falls back to its source's fallback region's remainder. */
export function mapSourceCategory(category: Pick<SourceCategory, "id" | "source" | "section">): SourceCategoryMapping {
  const target = Object.hasOwn(MAPPING, category.id) ? MAPPING[category.id] : undefined;
  if (typeof target === "string") return { category: target, kind: "mapped", home: null };
  if (target) return { category: null, kind: "catch-all", home: target.home };
  return { category: remainderOf(fallbackRegion(category)).id, kind: "fallback", home: null };
}

/** One app placed by hand: its category and the one-line reason, read from what the sources say about the app. */
export interface Placement {
  category: string;
  reason: string;
}

/** Reads `pipeline/placements.json`: app id → placement. Throws on a malformed file or an unknown category. */
export function loadPlacements(path: string): Map<string, Placement> {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${path}: expected an object of app id → placement`);
  const placements = new Map<string, Placement>();
  for (const [app, value] of Object.entries(raw)) {
    if (app.startsWith("$")) continue;
    const entry = value as Partial<Placement> | null;
    if (typeof entry?.category !== "string" || typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`${path}: ${app} needs a category and a reason`);
    }
    if (!byId.has(entry.category)) throw new Error(`${path}: ${app} names unknown category ${entry.category}`);
    placements.set(app, { category: entry.category, reason: entry.reason });
  }
  return placements;
}

/** How an app got its category. */
export type Resolution = "placed" | "mapped" | "fallback" | "awaiting";

export interface Assignment {
  category: string;
  how: Resolution;
}

/**
 * The one category an app is filed under. A placement wins. Otherwise the
 * first listing, by source priority then position (the listing order of
 * `sortListings`), whose upstream category is not a catch-all decides.
 * When every listing is in a catch-all, the app waits in the remainder of
 * its first listing's catch-all's region until someone places it.
 */
export function resolveCategory(
  appId: string,
  listingCategories: readonly string[],
  mappings: ReadonlyMap<string, SourceCategoryMapping>,
  placements: ReadonlyMap<string, Placement>,
): Assignment {
  const placement = placements.get(appId);
  if (placement) return { category: placement.category, how: "placed" };
  for (const id of listingCategories) {
    const mapping = mappings.get(id);
    if (mapping?.category) return { category: mapping.category, how: mapping.kind === "fallback" ? "fallback" : "mapped" };
  }
  const home = listingCategories.map((id) => mappings.get(id)?.home).find((h): h is string => typeof h === "string");
  return { category: remainderOf(home ?? "system").id, how: "awaiting" };
}

/** The taxonomy of one build, with counts: what the build report and docs/TAXONOMY.md list. */
export interface TaxonomyDescription {
  categories: { id: string; name: string; region: string; remainder: boolean; apps: number; takesIn: string[] }[];
  mapping: { sourceCategory: string; source: string; name: string; section: string | null; kind: MappingKind; category: string | null; home: string | null; listings: number }[];
  placements: { app: string; name: string | null; category: string; reason: string }[];
  /** Apps in a remainder because every listing is in a catch-all and nobody has placed them. */
  awaiting: { app: string; name: string; category: string; sourceCategories: string[] }[];
  /** Upstream categories missing from `MAPPING`, sent to a remainder. */
  fallbacks: { sourceCategory: string; name: string; category: string }[];
  /** Placements whose app is no longer in the catalog. */
  stale: { app: string; category: string; reason: string }[];
}

type DescribedCatalog = {
  categories: readonly Category[];
  sourceCategories: readonly SourceCategory[];
  apps: readonly { id: string; name: string; category: string; listings: readonly { category: string }[] }[];
};

/** Describes a built catalog's taxonomy: every category with its count, every mapping, every placement, and what needs a person's attention. */
export function describeTaxonomy(catalog: DescribedCatalog, filing: ReadonlyMap<string, Resolution>, placements: ReadonlyMap<string, Placement>): TaxonomyDescription {
  const appsIn = new Map<string, number>();
  for (const app of catalog.apps) appsIn.set(app.category, (appsIn.get(app.category) ?? 0) + 1);
  const listingsIn = new Map<string, number>();
  for (const app of catalog.apps) for (const id of new Set(app.listings.map((l) => l.category))) listingsIn.set(id, (listingsIn.get(id) ?? 0) + 1);
  const mapping = catalog.sourceCategories.map((c) => {
    const mapped = mapSourceCategory(c);
    return { sourceCategory: c.id, source: c.source, name: c.name, section: c.section, kind: mapped.kind, category: mapped.category, home: mapped.home, listings: listingsIn.get(c.id) ?? 0 };
  });
  const names = new Map(catalog.apps.map((app) => [app.id, app.name]));
  return {
    categories: catalog.categories.map((c) => ({
      id: c.id,
      name: c.name,
      region: c.region,
      remainder: c.remainder,
      apps: appsIn.get(c.id) ?? 0,
      takesIn: mapping.filter((m) => m.category === c.id && m.kind === "mapped").map((m) => m.sourceCategory),
    })),
    mapping,
    placements: [...placements].map(([app, p]) => ({ app, name: names.get(app) ?? null, category: p.category, reason: p.reason })),
    awaiting: catalog.apps
      .filter((app) => filing.get(app.id) === "awaiting")
      .map((app) => ({ app: app.id, name: app.name, category: app.category, sourceCategories: [...new Set(app.listings.map((l) => l.category))] })),
    fallbacks: mapping.filter((m) => m.kind === "fallback").map((m) => ({ sourceCategory: m.sourceCategory, name: m.name, category: m.category ?? "" })),
    stale: [...placements].filter(([app]) => !names.has(app)).map(([app, p]) => ({ app, category: p.category, reason: p.reason })),
  };
}

/** Maps every source category of a build, by id. */
export function mappingsOf(categories: readonly Pick<SourceCategory, "id" | "source" | "section">[]): Map<string, SourceCategoryMapping> {
  return new Map(categories.map((category) => [category.id, mapSourceCategory(category)]));
}
