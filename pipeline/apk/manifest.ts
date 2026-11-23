/**
 * What a parsed manifest declares: the interfaces a package offers other apps
 * and the system, each with its component's `exported` flag and guarding
 * permission exactly as written.
 *
 * Elements are read only where Android reads them (`manifest > application >
 * activity > intent-filter > action`, and so on). Framework attributes are
 * matched by resource id, which is what Android matches, and by name only
 * when the file maps no id to them. Values are validated before they are
 * kept; a resource reference or an unexpected value becomes `Unread`.
 */
import type {
  ComponentType,
  Declared,
  DeclaredComponent,
  PackageInterfaces,
  TaskerRole,
  Unread,
} from "../../schema/package-reading.ts";
import type { AxmlAttribute, AxmlElement } from "./axml.ts";

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

/** Framework attribute ids (`android.R.attr`). */
const ATTR = {
  name: 0x01010003,
  permission: 0x01010006,
  exported: 0x01010010,
  mimeType: 0x01010026,
  scheme: 0x01010027,
  host: 0x01010028,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
} as const;

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const CLASS_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
/** Printable ASCII without spaces: actions, categories and permissions. */
const TOKEN_RE = /^[\x21-\x7e]+$/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*$/;
/** A host name, or Android's leading `*` wildcard. */
const HOST_RE = /^(\*|(\*\.)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*)$/;
const MIME_RE = /^[A-Za-z0-9*][A-Za-z0-9!#$&^_.+*-]*(\/[A-Za-z0-9*][A-Za-z0-9!#$&^_.+*-]*)?$/;
const MAX_TOKEN = 512;

const TILE = "android.service.quicksettings.action.QS_TILE";
const SEND = "android.intent.action.SEND";
const SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE";
const VIEW = "android.intent.action.VIEW";
const BROWSABLE = "android.intent.category.BROWSABLE";
const TASKER: Readonly<Record<string, TaskerRole>> = {
  "com.twofortyfouram.locale.intent.action.EDIT_SETTING": "action-edit",
  "com.twofortyfouram.locale.intent.action.FIRE_SETTING": "action-fire",
  "com.twofortyfouram.locale.intent.action.EDIT_CONDITION": "condition-edit",
  "com.twofortyfouram.locale.intent.action.QUERY_CONDITION": "condition-query",
  "net.dinglisch.android.tasker.ACTION_EDIT_EVENT": "event-edit",
};
/** Namespaces whose actions belong to the platform or a library, not to the app. */
const PLATFORM_PREFIXES = ["android.", "com.android.", "androidx.", "com.google.", "com.twofortyfouram.", "net.dinglisch.android.tasker."];
const SHIZUKU_PERMISSION = "moe.shizuku.manager.permission.API_V23";
const SHIZUKU_PROVIDER = "rikka.shizuku.ShizukuProvider";

const COMPONENT_TAGS: readonly ComponentType[] = ["activity", "activity-alias", "service", "receiver"];

export class ManifestError extends Error {}

export interface ManifestFacts {
  package: string;
  version: { name: Declared<string> | null; code: number | null };
  interfaces: PackageInterfaces;
}

function children(element: AxmlElement | undefined, tag: string): AxmlElement[] {
  return element ? element.children.filter((child) => child.name === tag) : [];
}

function androidAttribute(element: AxmlElement, id: number, name: string): AxmlAttribute | undefined {
  return (
    element.attributes.find((a) => a.resourceId === id) ??
    element.attributes.find((a) => a.resourceId === null && a.ns === ANDROID_NS && a.name === name)
  );
}

const unexpected: Unread = { unread: "unexpected-value" };

function reference(ref: number): Unread {
  return { unread: "resource-reference", ref: `0x${ref.toString(16).padStart(8, "0")}` };
}

function matching(value: string | null, pattern: RegExp): Declared<string> {
  return value !== null && value.length <= MAX_TOKEN && pattern.test(value) ? value : unexpected;
}

/** A string attribute as declared: the text if it matches `pattern`, `Unread`, or null when absent. */
function text(element: AxmlElement, id: number, name: string, pattern: RegExp = TOKEN_RE): Declared<string> | null {
  const attribute = androidAttribute(element, id, name);
  if (!attribute) return null;
  const value = attribute.value;
  if (value.type === "reference") return reference(value.ref);
  return value.type === "string" ? matching(value.value, pattern) : unexpected;
}

function flag(element: AxmlElement, id: number, name: string): Declared<boolean> | null {
  const attribute = androidAttribute(element, id, name);
  if (!attribute) return null;
  const value = attribute.value;
  if (value.type === "reference") return reference(value.ref);
  return value.type === "boolean" ? value.value : unexpected;
}

function className(element: AxmlElement, pkg: string): Declared<string> {
  const name = text(element, ATTR.name, "name");
  if (name === null) return unexpected;
  if (typeof name !== "string") return name;
  const full = name.startsWith(".") ? pkg + name : name.includes(".") ? name : `${pkg}.${name}`;
  return full.length <= MAX_TOKEN && CLASS_RE.test(full) ? full : unexpected;
}

function isText(value: Declared<string> | null): value is string {
  return typeof value === "string";
}

function unique(values: Declared<string>[]): Declared<string>[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface Filter {
  actions: Declared<string>[];
  categories: Declared<string>[];
  schemes: Declared<string>[];
  hosts: Declared<string>[];
  mimeTypes: Declared<string>[];
}

function readFilter(element: AxmlElement): Filter {
  const names = (tag: string): Declared<string>[] =>
    children(element, tag).flatMap((child) => text(child, ATTR.name, "name") ?? []);
  const data = children(element, "data");
  const values = (id: number, name: string, pattern: RegExp): Declared<string>[] =>
    unique(data.flatMap((d) => text(d, id, name, pattern) ?? []));
  return {
    actions: names("action"),
    categories: names("category"),
    schemes: values(ATTR.scheme, "scheme", SCHEME_RE),
    hosts: values(ATTR.host, "host", HOST_RE),
    mimeTypes: values(ATTR.mimeType, "mimeType", MIME_RE),
  };
}

function isPlatformAction(action: string): boolean {
  return PLATFORM_PREFIXES.some((prefix) => action.startsWith(prefix));
}

/** Reads the facts of a manifest's root element. Throws `ManifestError` when the root is not a manifest with a valid package id. */
export function readManifest(root: AxmlElement): ManifestFacts {
  if (root.name !== "manifest") throw new ManifestError("root element is not <manifest>");
  const pkgAttribute = root.attributes.find((a) => a.name === "package" && a.ns === null);
  const pkg = pkgAttribute?.value.type === "string" ? pkgAttribute.value.value : null;
  if (pkg === null || pkg.length > MAX_TOKEN || !PACKAGE_RE.test(pkg)) throw new ManifestError("manifest has no valid package id");

  const codeAttribute = androidAttribute(root, ATTR.versionCode, "versionCode");
  const code = codeAttribute?.value.type === "int" ? codeAttribute.value.value : null;

  const interfaces: PackageInterfaces = {
    tiles: [],
    taskerPlugin: [],
    shareTargets: [],
    links: [],
    actions: [],
    shizuku: {
      permission: children(root, "uses-permission").some((p) => text(p, ATTR.name, "name") === SHIZUKU_PERMISSION),
      provider: false,
    },
  };

  const application = children(root, "application")[0];
  interfaces.shizuku.provider = children(application, "provider").some((p) => className(p, pkg) === SHIZUKU_PROVIDER);

  for (const type of COMPONENT_TAGS) {
    for (const element of children(application, type)) {
      const component: DeclaredComponent = {
        type,
        name: className(element, pkg),
        exported: flag(element, ATTR.exported, "exported"),
        permission: text(element, ATTR.permission, "permission"),
      };
      const filters = children(element, "intent-filter").map(readFilter);
      const actions = filters.flatMap((f) => f.actions);
      const isActivity = type === "activity" || type === "activity-alias";

      if (type === "service" && actions.includes(TILE)) interfaces.tiles.push(component);
      for (const role of new Set(actions.filter(isText).flatMap((a) => TASKER[a] ?? []))) {
        interfaces.taskerPlugin.push({ role, component });
      }
      if (component.exported !== false) {
        for (const action of unique(actions)) {
          if (!isText(action) || !isPlatformAction(action)) interfaces.actions.push({ action, component });
        }
      }
      if (!isActivity) continue;
      for (const filter of filters) {
        const single = filter.actions.includes(SEND);
        const multiple = filter.actions.includes(SEND_MULTIPLE);
        if (single || multiple) interfaces.shareTargets.push({ component, single, multiple, mimeTypes: filter.mimeTypes });
        if (filter.actions.includes(VIEW) && filter.schemes.length) {
          interfaces.links.push({
            component,
            schemes: filter.schemes,
            hosts: filter.hosts,
            browsable: filter.categories.includes(BROWSABLE),
          });
        }
      }
    }
  }

  return {
    package: pkg,
    version: { name: text(root, ATTR.versionName, "versionName"), code },
    interfaces,
  };
}
