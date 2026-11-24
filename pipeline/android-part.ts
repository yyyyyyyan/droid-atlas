/**
 * The part that carries Android's own statements about permissions
 * (`schema/parts.ts`, `AndroidPermissionsPart`), made from the committed
 * table (`lib/android-permissions.ts`). It keeps only the names some app's
 * index lists, so it grows with the catalog, not with Android.
 *
 * The statements are Apache-2.0. The header carries what the license asks of
 * a redistribution: the copyright notices of the two files read, the
 * attribution notice of the repository's NOTICE file that covers them, and
 * a statement of what was changed (docs/LICENSING.md).
 */
import type { DetailsEntry } from "../schema/catalog.ts";
import type { AndroidPermission, AndroidPermissionsPart, PartHeader } from "../schema/parts.ts";
import type { AndroidTable } from "./lib/android-permissions.ts";

/** The attribution notice of platform/frameworks/base's NOTICE file that covers Android's own code, quoted. */
export const AOSP_NOTICE = "Android Code. Copyright 2005-2008 The Android Open Source Project. This product includes software developed as part of The Android Open Source Project (http://source.android.com).";

/** "platform/frameworks/base" for its address: the header's source URL already links the repository, and a bare path wraps on a phone. */
function repositoryPath(url: string): string {
  return url.replace(/^https:\/\/android\.googlesource\.com\//, "");
}

export function androidHeader(table: AndroidTable, date: string): PartHeader {
  const { source } = table;
  return {
    source: { name: `Android ${table.androidVersion} (${source.name})`, url: source.repository, commit: source.commit, retrieved: source.retrieved },
    license: source.license,
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
    attribution: `${source.files.join(" and ")} of ${repositoryPath(source.repository)} at ${source.tag}, each "Copyright 2006, The Android Open Source Project", under the Apache License 2.0. NOTICE: ${AOSP_NOTICE}`,
    changes: `${table.changes} Written to JSON by Droid Atlas on ${date}, keeping only the names apps in this catalog declare.`,
    warranty: "Distributed on an \"AS IS\" basis, without warranties or conditions of any kind; see the license.",
  };
}

/** The statements for every name some details entry lists, by name, in name order. */
export function androidPermissionsPart(table: AndroidTable, details: Record<"fdroid" | "izzy", Record<string, DetailsEntry>>, date: string): AndroidPermissionsPart {
  const declared = new Set(Object.values(details).flatMap((byApp) => Object.values(byApp).flatMap((entry) => entry.permissions ?? [])));
  const permissions: Record<string, AndroidPermission> = {};
  for (const row of table.permissions) {
    if (declared.has(row.name)) permissions[row.name] = { protectionLevel: row.protectionLevel, label: row.label };
  }
  return {
    header: androidHeader(table, date),
    android: { version: table.androidVersion, tag: table.source.tag, commit: table.source.commit },
    permissions,
  };
}
