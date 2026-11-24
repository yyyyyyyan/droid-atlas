/**
 * Filter facets and the evidence behind them, computed once per app from what
 * its sources state. See the doc comments on `Facets` and `Evidence` in the
 * schema: booleans that no source ever states the negative of are true when
 * any source says so; three-state facets are null when no source can tell.
 */
import type { App, Evidence, Facets, Listing, Openness, Origin, Pricing, Sourced } from "../schema/catalog.ts";
import { classifyLicense } from "./lib/licenses.ts";

export interface FacetInput {
  listings: Listing[];
  channels: App["channels"];
  index: App["index"];
  github: App["github"];
  /** Licenses stated by the indexes and GitHub (listing licenses are read from the listings). */
  licenses: Sourced<string>[];
}

const ORIGIN_ORDER: Origin[] = ["android-foss", "awesome-shizuku", "droid-atlas", "fdroid", "izzy", "github"];
const OPENNESS_RANK: Openness[] = ["open-source", "source-available", "closed-source"];

function byOrigin(a: Origin, b: Origin): number {
  return ORIGIN_ORDER.indexOf(a) - ORIGIN_ORDER.indexOf(b);
}

function origins(list: Origin[]): Origin[] {
  return [...new Set(list)].sort(byOrigin);
}

function statements<T extends string>(list: Sourced<T>[], rank: readonly T[]): Sourced<T>[] {
  const seen = new Set<string>();
  const unique = list.filter((s) => {
    const key = `${s.origin}:${s.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => byOrigin(a.origin, b.origin) || rank.indexOf(a.value) - rank.indexOf(b.value));
}

/**
 * Who states which openness. A tag on a listing is that source's statement;
 * a free license stated by any source is that source's statement of
 * open source; Android FOSS listing an app (not a guide) states it is FOSS,
 * which is the list's whole scope.
 */
export function opennessEvidence(input: FacetInput): Sourced<Openness>[] {
  const found: Sourced<Openness>[] = [];
  for (const listing of input.listings) {
    if (listing.tags.includes("closed-source")) found.push({ value: "closed-source", origin: listing.source });
    else if (listing.tags.includes("source-available")) found.push({ value: "source-available", origin: listing.source });
    else if (classifyLicense(listing.license) === "foss") found.push({ value: "open-source", origin: listing.source });
    else if (listing.source === "android-foss" && listing.kind === "app") found.push({ value: "open-source", origin: listing.source });
  }
  for (const license of input.licenses) {
    if (classifyLicense(license.value) === "foss") found.push({ value: "open-source", origin: license.origin });
  }
  return statements(found, OPENNESS_RANK);
}

/**
 * Who states which pricing. awesome-shizuku's contribution rules require the
 * Paid, IAP and trial tags whenever they apply, so an untagged listing there is
 * its statement that the app is free; F-Droid and IzzyOnDroid distribute only
 * free-of-charge builds.
 */
export function pricingEvidence(input: FacetInput): Sourced<Pricing>[] {
  const found: Sourced<Pricing>[] = [];
  for (const listing of input.listings) {
    const tagged = (["paid", "trial", "iap"] as const).filter((tag) => listing.tags.includes(tag));
    for (const tag of tagged) found.push({ value: tag, origin: listing.source });
    if (!tagged.length && listing.source === "awesome-shizuku" && listing.kind === "app") found.push({ value: "free", origin: listing.source });
  }
  for (const channel of input.channels) {
    if ((channel.type === "fdroid" || channel.type === "izzy") && channel.listed === true && channel.variant === null) {
      found.push({ value: "free", origin: channel.type });
    }
  }
  return statements(found, ["free", "iap", "trial", "paid"]);
}

/** The evidence the facets rest on. Who gave the repository is recorded where the repository is chosen (`identity.ts`). */
export function computeEvidence(input: FacetInput): Omit<Evidence, "repository"> {
  const listed = (predicate: (listing: Listing) => boolean): Origin[] => input.listings.filter(predicate).map((l) => l.source);
  return {
    shizuku: origins([
      ...input.index.filter((i) => i.declaresShizuku).map((i) => i.origin),
      ...listed((l) => l.source === "awesome-shizuku"),
    ]),
    root: origins(listed((l) => l.tags.includes("root"))),
    archived: origins([...listed((l) => l.tags.includes("archived")), ...(input.github?.archived ? (["github"] as const) : [])]),
    noInternet: origins(input.index.filter((i) => !i.declaresInternet).map((i) => i.origin)),
    openness: opennessEvidence(input),
    pricing: pricingEvidence(input),
  };
}

export function computeFacets(input: FacetInput, evidence: Omit<Evidence, "repository">): Facets {
  const openness = evidence.openness.reduce<Openness | null>(
    (most, s) => (most === null || OPENNESS_RANK.indexOf(s.value) > OPENNESS_RANK.indexOf(most) ? s.value : most),
    null,
  );
  const hasIndex = input.index.length > 0;
  return {
    shizuku: evidence.shizuku.length > 0,
    root: evidence.root.length > 0,
    paid: evidence.pricing.some((s) => s.value === "paid" || s.value === "trial"),
    recommended: input.listings.some((l) => l.tags.includes("recommended")),
    fork: Boolean(input.github?.forkOf),
    staleLink: input.channels.some((c) => c.listed === false),
    onFdroid: input.channels.some((c) => c.type === "fdroid" && c.listed === true),
    onIzzy: input.channels.some((c) => c.type === "izzy" && c.listed === true),
    openness,
    noInternet: hasIndex ? input.index.every((i) => !i.declaresInternet) : null,
    apkOnGithub: input.github ? (input.github.release?.hasApk ?? false) : null,
    noAntiFeatures: hasIndex ? input.index.every((i) => i.antiFeatures.length === 0) : null,
    archived: evidence.archived.length > 0 ? true : input.github ? false : null,
  };
}
