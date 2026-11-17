/**
 * Classifies license strings as sources state them ("GPL-3.0-or-later",
 * "Apache 2.0", "Proprietary") into free/open-source, explicitly not free,
 * or unknown. Used for the openness facet only; the string itself is always
 * shown verbatim.
 */

export type LicenseClass = "foss" | "nonfree" | "unknown";

/** OSI- or FSF-approved licenses seen in the sources, by normalized SPDX id without version suffixes. */
const FOSS = new Set(
  [
    "0BSD", "AFL-3.0", "AGPL-3.0", "APACHE-1.1", "APACHE-2.0", "APSL-2.0", "ARTISTIC-2.0", "BSD-1-CLAUSE", "BSD-2-CLAUSE",
    "BSD-3-CLAUSE", "BSD-3-CLAUSE-CLEAR", "BSD-4-CLAUSE", "BSL-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0", "CDDL-1.0",
    "CECILL-2.1", "ECL-2.0", "EPL-1.0", "EPL-2.0", "EUPL-1.1", "EUPL-1.2", "GPL-2.0", "GPL-3.0", "ISC", "LGPL-2.0",
    "LGPL-2.1", "LGPL-3.0", "LPPL-1.3C", "MIT", "MIT-0", "MPL-1.1", "MPL-2.0", "MS-PL", "MS-RL", "MULANPSL-2.0", "NCSA",
    "OFL-1.1", "OSL-3.0", "POSTGRESQL", "PYTHON-2.0", "UNLICENSE", "UPL-1.0", "VIM", "W3C", "WTFPL", "X11", "ZLIB",
    "ZPL-2.1", "AGPL-1.0", "GFDL-1.3", "CC-BY-3.0", "CC-BY-SA-3.0", "BLUEOAK-1.0.0",
  ],
);

const ALIASES: Record<string, string> = {
  GPLV2: "GPL-2.0",
  GPLV3: "GPL-3.0",
  GPL2: "GPL-2.0",
  GPL3: "GPL-3.0",
  LGPLV3: "LGPL-3.0",
  AGPLV3: "AGPL-3.0",
  APACHE2: "APACHE-2.0",
  "APACHE-2": "APACHE-2.0",
  "APACHE-LICENSE-2.0": "APACHE-2.0",
  "BSD-3": "BSD-3-CLAUSE",
  "BSD-2": "BSD-2-CLAUSE",
  "MPL-2": "MPL-2.0",
  "MIT-LICENSE": "MIT",
  PUBLICDOMAIN: "UNLICENSE",
};

const NONFREE_RE = /^(PROPRIETARY|PROPIETARY|NO-LICENSE|NONE|ALL-RIGHTS-RESERVED|SOURCE-AVAILABLE|POLYFORM-.*|CC-BY(-SA)?-NC.*|CC-BY-ND.*|CC-BY-NC-ND.*|BUSL-.*|SSPL-.*|COMMONS-CLAUSE|ELASTIC-.*|NPOSL-.*|FAIR-SOURCE.*)$/;

function normalize(term: string): string {
  const id = term
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/-(ONLY|OR-LATER)$/, "")
    .replace(/\+$/, "");
  return ALIASES[id] ?? id;
}

function classifyTerm(term: string): LicenseClass {
  const id = normalize(term);
  if (!id) return "unknown";
  if (FOSS.has(id)) return "foss";
  if (NONFREE_RE.test(id)) return "nonfree";
  return "unknown";
}

/**
 * Classifies an SPDX-like expression. `OR` is free when any alternative is
 * free; `AND` and `WITH` are free only when every part is. Anything with a
 * word the table does not know ("Modified MPL-2.0") is unknown.
 */
export function classifyLicense(text: string | null | undefined): LicenseClass {
  if (!text) return "unknown";
  const expression = text.replace(/[()]/g, " ").trim();
  if (!expression) return "unknown";
  const alternatives = expression.split(/\s+OR\s+|\s*\/\s*/i);
  const classes = alternatives.map((alternative) => {
    const parts = alternative.split(/\s+AND\s+|\s+WITH\s+/i);
    const withoutExceptions = parts.filter((part, i) => i === 0 || !/EXCEPTION$/i.test(part.trim()));
    const each = withoutExceptions.map(classifyTerm);
    if (each.every((c) => c === "foss")) return "foss";
    if (each.some((c) => c === "nonfree")) return "nonfree";
    return "unknown";
  });
  if (classes.includes("foss")) return "foss";
  if (classes.every((c) => c === "nonfree")) return "nonfree";
  return "unknown";
}
