/** What every source parser produces, before enrichment and merging. */
import type { Anomaly, ChannelType, ListingTag, SourceId } from "../../schema/catalog.ts";

export interface ParsedCategory {
  /** `<source>/<slug>`. */
  id: string;
  source: SourceId;
  name: string;
  section: string | null;
  order: number;
  note: string | null;
}

export interface EntryChannel {
  type: ChannelType;
  pkg: string;
  variant: string | null;
}

export interface SourceEntry {
  source: SourceId;
  /** Upstream file the entry is on, relative to the list's repository root. */
  file: string;
  line: number;
  /** Position within its category in the upstream document, from 0. */
  order: number;
  /** "resource" for guides, sites, further reading and links into the list's own repository. */
  kind: "app" | "resource";
  name: string;
  /** The entry's main link, validated as http(s). */
  url: string;
  category: string;
  description: string | null;
  tags: ListingTag[];
  license: string | null;
  /** Index into the same source's entry array of the entry this one is nested under. */
  parent: number | null;
  /** A link the source labels as source code, when separate from `url`. */
  sourceCode: string | null;
  /** Store listings the entry links, which verify package ids. */
  channels: EntryChannel[];
  extraLinks: { name: string; url: string }[];
  /** Normalized URL the entry's first-seen date is looked up by. */
  historyKey: string;
  added: string | null;
}

/** A part of the upstream document that is deliberately not imported. */
export interface SkippedSection {
  file: string;
  line: number;
  heading: string;
  /** List items inside it, so the report can say how much was left out. */
  items: number;
  reason: string;
}

/** Text the source attaches somewhere other than a category, kept for the report. */
export interface LooseNote {
  file: string;
  line: number;
  text: string;
  /** What the note was attached to, or why it was not. */
  placement: string;
}

export interface ParsedSource {
  categories: ParsedCategory[];
  entries: SourceEntry[];
  anomalies: Anomaly[];
  /** Upstream lines inside the parsed body, the denominator of the anomaly gate. */
  lines: number;
  skipped: SkippedSection[];
  notes: LooseNote[];
  /** Annotations or license strings the parser does not recognize, with how often they occur. */
  unknownTokens: { token: string; count: number }[];
}
