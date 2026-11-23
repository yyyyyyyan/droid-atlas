/**
 * A package reading: what one version of an app's package declares in its
 * manifest, read without running anything (`pipeline/apk/`).
 *
 * Every reading carries its evidence level, which is always
 * "statically-discovered": the facts were read from the package, not stated
 * by the project, not reported by anyone and not observed by running the app.
 * A declaration says an interface exists in that version's manifest; it says
 * nothing about whether the interface does anything.
 *
 * Values in the manifest that point into the package's resource table (labels,
 * and any attribute written as `@string/…` or `@bool/…`) are recorded as not
 * read. They are never guessed.
 */
import type { EvidenceLevel } from "./catalog.ts";

export const PACKAGE_READING_FORMAT = 1;

/** Hosts a package may be read from. IzzyOnDroid is not one of them. */
export type PackageHost = "fdroid" | "github";

/** A manifest value that was not read, and why. */
export type Unread =
  /** The value is a reference into the resource table, given as `0x7f…`. */
  | { unread: "resource-reference"; ref: string }
  /** The value has a type or text this reader does not accept. */
  | { unread: "unexpected-value" };

/** A value as the manifest declares it, or the reason it was not read. */
export type Declared<T> = T | Unread;

/** The kinds of component that declare intent filters. */
export type ComponentType = "activity" | "activity-alias" | "service" | "receiver";

/** A component as its manifest element declares it. Nothing is inferred from defaults. */
export interface DeclaredComponent {
  type: ComponentType;
  /** Fully qualified class name; a relative name is joined to the package id, as Android does. */
  name: Declared<string>;
  /** `android:exported` as written, or null when the manifest does not state it. */
  exported: Declared<boolean> | null;
  /** `android:enabled` as written, or null when the manifest does not state it. A component the manifest disables may be enabled while the app runs. */
  enabled: Declared<boolean> | null;
  /** `android:permission` as written, or null when the manifest states none. */
  permission: Declared<string> | null;
}

/** The roles a Tasker (Locale) plug-in component declares, by the action it filters for. */
export type TaskerRole = "action-edit" | "action-fire" | "condition-edit" | "condition-query" | "event-edit";

export interface PackageInterfaces {
  /** Services that offer a Quick Settings tile. */
  tiles: DeclaredComponent[];
  /** Components that answer Tasker (Locale) plug-in actions. */
  taskerPlugin: { role: TaskerRole; component: DeclaredComponent }[];
  /** Activities that accept shared content, with the content types they name. */
  shareTargets: {
    component: DeclaredComponent;
    /** The filter names `SEND`: one item at a time. */
    single: boolean;
    /** The filter names `SEND_MULTIPLE`: several items at once. */
    multiple: boolean;
    mimeTypes: Declared<string>[];
  }[];
  /** Activities that open links, with the schemes and hosts their filters name. */
  links: {
    component: DeclaredComponent;
    schemes: Declared<string>[];
    hosts: Declared<string>[];
    /** The filter carries the `BROWSABLE` category, which lets a browser open it. */
    browsable: boolean;
  }[];
  /**
   * Actions of the app's own (outside Android's, AndroidX's, Google's and the
   * Tasker plug-in's namespaces) that components filter for, except where the
   * component is declared not exported.
   */
  actions: { action: Declared<string>; component: DeclaredComponent }[];
  /** Shizuku's permission among those requested, and Shizuku's provider among the components. */
  shizuku: { permission: boolean; provider: boolean };
}

export interface PackageReading {
  format: typeof PACKAGE_READING_FORMAT;
  evidence: Extract<EvidenceLevel, "statically-discovered">;
  /** Who says so: the package itself, as served by this host at this address. */
  source: { host: PackageHost; url: string };
  file: {
    /** The file name in the address. */
    name: string;
    sizeBytes: number;
    /** SHA-256 of the whole file as the host's index or release states it, or null when none was given. */
    sha256: string | null;
  };
  /** ISO time the reading was made. */
  readAt: string;
  /** The `package` attribute of the manifest. */
  package: string;
  version: {
    /** `android:versionName`, or null when the manifest states none. */
    name: Declared<string> | null;
    /** `android:versionCode` (0 to 2,147,483,647), or null when the manifest states none. */
    code: Declared<number> | null;
  };
  /** The manifest as read from the package: SHA-256 and size of its uncompressed bytes. */
  manifest: { sha256: string; sizeBytes: number };
  /** Requests made and response body bytes received for this reading. */
  transfer: { requests: number; bytes: number };
  interfaces: PackageInterfaces;
}
