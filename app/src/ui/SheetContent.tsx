/**
 * What the sheet says about one entry, top to bottom.
 *
 * For an app, in the order a person asks: what it is and does (summary and
 * description), how to get it, its statistics (stars, releases, activity and
 * downloads, each from the source named), what else to know (one row per
 * fact, with who states it), and last, folded away, each catalog's own
 * listing with its credit.
 *
 * For a resource, which is a link and not an app: its title, the address it
 * leads to, its description when a source gives one, and who lists it.
 *
 * All catalog text is rendered as text. Every outbound link comes from
 * `links.ts`. Every sentence said in place of something missing comes from
 * `catalog/statements.ts`, which keeps it true of the entry it is shown on.
 */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { iconOwner, iconSourceWords } from "../catalog/credits.ts";
import { detailsSource, factsFor, hasStatistics, pricingLabel, privilegeWarning, statisticsFor, termChips, type Fact, type Statistics } from "../catalog/facts.ts";
import type { Description, IconRecord } from "../catalog/load.ts";
import { originName, type Entry } from "../catalog/model.ts";
import type { Listing, ListingTag } from "../catalog/schema.ts";
import { descriptionBlocks, descriptionSize, type DescriptionBlock } from "../catalog/description.ts";
import { framedNote } from "../catalog/statements.ts";
import { formatDate, licenseName, parseTime, timeAgo } from "../lib/format.ts";
import { actionsFor, hostOf, platformOf, readableUrl, safeWebUrl, shareUrl, type Action, type ActionKind } from "../links.ts";
import { leftBehind, reloadForNewShell } from "../offline/client.ts";
import { PRODUCT_NAME } from "../product.ts";
import { categoryRoute, HOW_COUNTED, regionRoute } from "../router/route.ts";
import { announce, useServices } from "../services.ts";
import { AppIcon } from "./AppIcon.tsx";
import { CopyButton, copyText } from "./Copy.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { AppLink, RouteLink } from "./Link.tsx";
import { NoteEditor } from "./NoteEditor.tsx";
import { qrDrawing } from "./qr.ts";
import { Names } from "./Whole.tsx";

const GROUPS: { id: string; kinds: readonly ActionKind[]; title: string }[] = [
  { id: "get", kinds: ["store", "import"], title: "Get it" },
  { id: "web", kinds: ["source", "web"], title: "Links" },
];

const ACTION_GLYPH: Record<ActionKind, IconName> = { store: "store", import: "import", source: "source", web: "web" };

/** The glyph an action wears: a download for anything that gets the app, Obtainium's own "add" only for adding to it. */
export function actionGlyph(action: Action): IconName {
  return action.id === "releases" ? "store" : ACTION_GLYPH[action.kind];
}

const TAG_LABELS: Record<ListingTag, string> = {
  recommended: "Recommended",
  paid: "Paid",
  iap: "In-app purchases",
  trial: "Free trial",
  ads: "Contains ads",
  root: "Uses root",
  "source-available": "Source-available",
  "closed-source": "Closed source",
  archived: "Archived",
};

/**
 * The words on the sheet's main button, in two parts: what a tap does, and
 * where it leads. The button shows the second alone when both do not fit.
 */
export function primaryParts(action: Action): { verb: string; what: string } {
  if (action.kind === "store") return { verb: "View on", what: action.label.replace(/^.* · /, "") };
  if (action.id === "releases") return { verb: "View", what: action.label };
  if (action.kind === "import") {
    const [, verb, what] = /^(Add to) (.+)$/.exec(action.label) ?? [];
    return verb && what ? { verb, what } : { verb: "Open", what: action.label };
  }
  if (action.kind === "source") return action.label === "Source code" ? { verb: "Open", what: "source code" } : { verb: "Open on", what: action.label };
  if (action.id === "link") return { verb: "Open", what: hostOf(action.href) ?? "the page" };
  return { verb: "Open", what: action.label === "Project site" ? "project site" : action.label };
}

/** The words on the sheet's main button: where the link leads, in as few words as say it. */
export function primaryLabel(action: Action): string {
  const { verb, what } = primaryParts(action);
  return `${verb} ${what}`;
}

/** An outbound link exactly as `links.ts` describes it: a new tab for every web page, the same window for the one link Android hands to an app by its scheme. */
export function ActionLink({ action, class: className, children }: { action: Action; class: string; children: preact.ComponentChildren }) {
  const blank = action.target === "_blank";
  return (
    <a href={action.href} class={className} target={blank ? "_blank" : undefined} rel={blank ? "noopener" : undefined}>
      {children}
    </a>
  );
}

/** An id or an address with a place to break after each dot, slash, dash and underscore, so a long one wraps between its parts and never strands a letter. */
function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[./_-])/);
  return <>{parts.map((part, index) => (index === 0 ? part : <><wbr />{part}</>))}</>;
}

function ActionRow({ action }: { action: Action }) {
  return (
    <li class={`act-item act-${action.kind}${action.stale ? " is-stale" : ""}`}>
      <ActionLink action={action} class="act">
        <span class="act-glyph"><Icon name={actionGlyph(action)} size={20} /></span>
        <span class="act-text">
          <span class="act-label">
            <span dir="auto">{action.label}</span>
            {action.stale && <span class="fchip fchip-caution">Gone</span>}
          </span>
          {action.detail && <span class="act-detail" dir="auto"><Breakable text={action.detail} /></span>}
          {action.note && <span class="act-note">{action.note}</span>}
        </span>
      </ActionLink>
      {action.copyText && <CopyButton text={action.copyText} label={action.kind === "import" && action.id !== "releases" ? "source link" : `${action.label} link`} tip="Copy link" class="act-copy" />}
      {action.needs && (
        <p class="act-needs">
          {action.needs.text} <a href={action.needs.href} target="_blank" rel="noopener">{action.needs.label}</a>
        </p>
      )}
    </li>
  );
}

function StatisticsBlock({ statistics, now }: { statistics: Statistics; now: number }) {
  const { stars, activity, releases, downloads } = statistics;
  return (
    <section class="sheet-section" aria-labelledby="sheet-stats">
      <h3 class="overline" id="sheet-stats">Statistics</h3>
      {(stars || activity) && (
        <dl class="stats">
          {stars && (
            <div class="stat">
              <dt>{stars.source} stars</dt>
              <dd><Icon name="star" size={18} filled />{stars.count.toLocaleString("en")}</dd>
            </div>
          )}
          {activity && (
            <div class="stat">
              <dt>{activity.what} ·{"\u00a0"}{activity.source}</dt>
              <dd>{formatDate(activity.at)}<span class="stat-ago">{timeAgo(activity.at, now)}</span></dd>
            </div>
          )}
        </dl>
      )}
      {releases.length > 0 && (
        <div class="stat-group">
          <h4 class="stat-title" id="sheet-releases">Latest release</h4>
          <ul class="stat-rows" aria-labelledby="sheet-releases">
            {releases.map((release) => (
              <li key={release.origin}>
                <span class="stat-source">{release.source}</span>
                <span class="stat-main" dir="auto">{release.version ?? "version not stated"}</span>
                <span class="stat-when">
                  {release.at !== null ? formatDate(release.at) : "date not stated"}
                  {release.note && <span class="stat-note">{release.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {downloads.length > 0 && (
        <div class="stat-group">
          <h4 class="stat-title" id="sheet-downloads">Downloads</h4>
          <ul class="stat-rows is-downloads" aria-labelledby="sheet-downloads">
            {downloads.map((figure) => (
              <li key={figure.origin}>
                <span class="stat-source">{figure.source}</span>
                <span class="stat-main">{figure.count.toLocaleString("en")}</span>
                <span class="stat-when">{figure.period}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {downloads.length > 0 && <p class="stat-foot"><RouteLink route={HOW_COUNTED}>How these are counted</RouteLink></p>}
    </section>
  );
}

/**
 * @param shared the source the block's heading names; a line names its own only when it differs
 */
function FactRow({ fact, shared }: { fact: Fact; shared: string | null }) {
  return (
    <div class="fact">
      <dt>{fact.label}</dt>
      <dd>
        {fact.lines.map((line, at) => {
          const sources = line.sources.join(", ");
          const own = sources !== "" && sources !== shared;
          return (
            <div class={`fact-line fact-${line.tone}${own ? " has-source" : ""}`} key={`${line.value}-${at}`}>
              <span class="fact-value">
                {line.tone === "caution" && <Icon name="warn" size={16} />}
                {line.tone === "good" && <Icon name="check" size={16} />}
                <span dir="auto">{line.value}</span>
              </span>
              {own && <span class="fact-source"><Names names={line.sources} /></span>}
              {line.quote && <q class="fact-quote" dir="auto">{line.quote}</q>}
              {line.detail && <span class="fact-detail" dir="auto">{line.detail}</span>}
            </div>
          );
        })}
      </dd>
    </div>
  );
}

function isExcerpt(text: string): boolean {
  return /(…|\.\.\.)\s*$/.test(text);
}

function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 300 || text.split("\n").length > 5;
  return (
    <>
      <p class={`desc${long && !open ? " is-clamped" : ""}`} dir="auto">{text}</p>
      {long && (
        <button type="button" class="link-btn desc-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
}

/** A long description as paragraphs and lists, shown in part until asked for in full when there is much of it. */
function Description({ blocks }: { blocks: readonly DescriptionBlock[] }) {
  const [open, setOpen] = useState(false);
  const size = descriptionSize(blocks);
  const long = size.characters > 320 || size.lines > 6;
  return (
    <>
      <div class={`desc desc-blocks${long && !open ? " is-clamped" : ""}`} dir="auto">
        {blocks.map((block, index) => (block.kind === "list"
          ? <ul key={index}>{block.items.map((item, at) => <li key={at}>{item}</li>)}</ul>
          : <p key={index}>{block.text}</p>))}
      </div>
      {long && (
        <button type="button" class="link-btn desc-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
}

/** One catalog's own entry: its wording, its category as it names it, its tags, and the credit its license asks for. */
function ListingBlock({ listing, entry }: { listing: Listing; entry: Entry }) {
  const { model } = useServices();
  const source = model.sourceById.get(listing.source);
  const category = model.sourceCategoryById.get(listing.category);
  const sourceUrl = source ? safeWebUrl(source.url) : null;
  const licenseUrl = source ? safeWebUrl(source.licenseUrl) : null;
  const entryUrl = safeWebUrl(listing.url);
  const added = parseTime(listing.added);
  const parent = listing.parent ? model.resolve(listing.parent) : null;
  const name = source?.name ?? listing.source;
  const section = category?.section;
  return (
    <article class="listing">
      <p class="credit">
        From {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener">{name}</a> : name}
        {source && <> · {licenseUrl ? <a href={licenseUrl} target="_blank" rel="noopener">{licenseName(source.license)}</a> : licenseName(source.license)}</>}
      </p>
      {listing.name !== entry.app.name && <p class="listing-name" dir="auto">Listed as “{listing.name}”</p>}
      {listing.description && (
        <>
          <Clamped text={listing.description} />
          {isExcerpt(listing.description) && <p class="credit-note">Excerpt</p>}
        </>
      )}
      {listing.tags.length > 0 && (
        <p class="listing-tags">
          {listing.tags.map((tag) => <span key={tag} class={`fchip ${tag === "recommended" ? "fchip-neutral" : "fchip-caution"}`}>{TAG_LABELS[tag] ?? tag}</span>)}
        </p>
      )}
      <dl class="listing-facts">
        {category && (
          <div>
            <dt>Category</dt>
            <dd dir="auto">
              “{category.name}”
              {section && section !== category.name && <span class="listing-aside"> under “{section}”</span>}
            </dd>
          </div>
        )}
        {listing.license && <div><dt>License</dt><dd dir="auto">{listing.license}</dd></div>}
        {added !== null && <div><dt>Listed since</dt><dd>{formatDate(added)}</dd></div>}
        {parent && <div><dt>Listed under</dt><dd><AppLink appId={parent.app.id}>{parent.app.name}</AppLink></dd></div>}
        {entryUrl && <div><dt>Link</dt><dd><a href={entryUrl} target="_blank" rel="noopener" dir="auto">{readableUrl(entryUrl) ?? entryUrl}</a></dd></div>}
      </dl>
    </article>
  );
}

/** `behind` on a failure: the device holds a newer catalog than the one on screen, so trying again will not help and loading the page again will. */
type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; behind: boolean; retry(): void };

function useOnDemand<T>(key: string, load: () => Promise<T>): Loadable<T> {
  const { build } = useServices();
  const [result, setResult] = useState<Loadable<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setResult({ state: "loading" });
    load().then(
      (value) => {
        if (current) setResult({ state: "ready", value });
      },
      async () => {
        /* The failure shows at once; finding out whether a newer catalog is the reason can take a check of the site. */
        const retry = (): void => setAttempt((count) => count + 1);
        if (current) setResult({ state: "failed", behind: false, retry });
        const behind = await leftBehind(build.dataRoot, build.version.hash);
        if (current && behind) setResult({ state: "failed", behind, retry });
      },
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);
  return result;
}

/**
 * What the entry is: its summary and its long description, each with who it
 * is from. When both are from one source the name is said once, under the
 * description. A summary or a description nobody gives is simply absent.
 */
function Described({ entry, actions }: { entry: Entry; actions: Action[] }) {
  const { model, onDemand } = useServices();
  const { summary } = entry.app;
  const asked = entry.app.index.map((facts) => facts.origin);
  const description = useOnDemand<Description | null>(entry.app.id, () => (asked.length ? onDemand.description(entry.app.id, asked) : Promise.resolve(null)));
  const first = description.state === "ready" ? description.value : null;
  const blocks = first ? descriptionBlocks(first.text, summary?.value ?? null) : [];
  /* While the description is on its way from the summary's own source, the one credit waits for it. */
  const creditFollows = summary !== null && (blocks.length > 0 ? first?.origin === summary.origin : description.state === "loading" && asked.some((origin) => origin === summary.origin));
  const page = first ? actions.find((action) => action.kind === "store" && action.id.startsWith(`${first.origin}:`))?.webHref ?? null : null;
  const name = first ? originName(model, first.origin) : "";
  return (
    <>
      {summary && <p class="sheet-summary" dir="auto">{summary.value}</p>}
      {summary && !creditFollows && <p class="credit">From {originName(model, summary.origin)}</p>}
      {asked.length > 0 && description.state === "loading" && <p class="credit-note" role="status">Loading…</p>}
      {description.state === "failed" && (description.behind ? (
        <p class="credit-note" role="status">
          A newer catalog is out.{" "}
          <button type="button" class="link-btn retry-btn" onClick={() => void reloadForNewShell()}>Reload</button>
        </p>
      ) : (
        <p class="credit-note" role="status">
          The description did not load.{" "}
          <button type="button" class="link-btn retry-btn" onClick={description.retry}>Try again</button>
        </p>
      ))}
      {first && blocks.length > 0 && (
        <div class="sheet-desc">
          <Description blocks={blocks} />
          <p class="credit">
            From {page ? <a href={page} target="_blank" rel="noopener">{name}</a> : name}{isExcerpt(first.text) && " · excerpt"}
          </p>
        </div>
      )}
    </>
  );
}

function IconCredit({ entry }: { entry: Entry }) {
  const { onDemand } = useServices();
  const path = entry.app.icon ?? "";
  const record = useOnDemand<IconRecord | null>(path, () => (path ? onDemand.iconRecord(path) : Promise.resolve(null)));
  if (!path || record.state !== "ready" || !record.value) return null;
  const { rule, license, author } = record.value;
  return (
    <p class="credit">Icon: {iconOwner(author)} · {iconSourceWords(rule)} · {license === "not stated" ? "no license stated" : licenseName(license)}</p>
  );
}

function ShareRow({ entry }: { entry: Entry }) {
  const url = shareUrl(entry.app.id, window.location.href);
  const [label, setLabel] = useState("Copy link to this page");
  const copy = async (): Promise<void> => {
    const ok = await copyText(url);
    announce(ok ? "Link copied" : "Copying failed");
    setLabel(ok ? "Copied" : "Copy failed");
    setTimeout(() => setLabel("Copy link to this page"), 1800);
  };
  const [code, setCode] = useState(false);
  return (
    <>
      <div class="share-row">
        <button type="button" class="btn" onClick={() => void copy()}><Icon name="copy" size={18} />{label}</button>
        {typeof navigator.share === "function" && (
          <button type="button" class="btn" onClick={() => void navigator.share({ title: `${entry.app.name} · ${PRODUCT_NAME}`, url }).catch(() => undefined)}>
            <Icon name="share" size={18} />Share
          </button>
        )}
        {platformOf() === "desktop" && (
          <button type="button" class="btn only-desk" aria-expanded={code} onClick={() => setCode(!code)}>
            <Icon name="phone" size={18} />Open on phone
          </button>
        )}
      </div>
      {code && <PhoneCode url={url} />}
    </>
  );
}

/** The width of the code's white plate: one size for every app, a shorter link drawn with larger modules. */
const PHONE_CODE_PX = 164;

/**
 * The page's link as a QR code, for a phone's camera to open, with a line
 * saying so. Made in the page; dark on white in either theme, which every
 * reader can read. It opens at the foot of the panel, so it brings itself
 * into view.
 */
function PhoneCode({ url }: { url: string }) {
  const drawing = useMemo(() => qrDrawing(url), [url]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div ref={ref} class="share-code only-desk">
      <svg class="share-qr" role="img" aria-label="QR code of the link to this page" viewBox={`0 0 ${drawing.side} ${drawing.side}`} width={PHONE_CODE_PX} height={PHONE_CODE_PX} shape-rendering="crispEdges">
        <rect width={drawing.side} height={drawing.side} fill="#fff" />
        <path d={drawing.path} fill="#000" />
      </svg>
      <p class="share-code-text">Point your phone’s camera here to open this page.</p>
    </div>
  );
}

/** Where Droid Atlas files the app: its category, then its region. */
function Places({ entry }: { entry: Entry }) {
  const { model } = useServices();
  const region = model.regionById.get(entry.app.region);
  if (!entry.category && !region) return null;
  return (
    <span class="sheet-places">
      {entry.category && <RouteLink route={categoryRoute(entry.category.id)}>{entry.category.name}</RouteLink>}
      {entry.category && region && <span aria-hidden="true">·</span>}
      {region && <RouteLink route={regionRoute(region.region.id)}>{region.region.name}</RouteLink>}
    </span>
  );
}

function ActionGroups({ entry, actions }: { entry: Entry; actions: Action[] }) {
  const { framed } = useServices();
  return (
    <>
      {GROUPS.map((group) => {
        /* A guide's own page leads its section; an app's repository leads its links. */
        const kinds = entry.resource && group.id === "web" ? ["web", "source"] : group.kinds;
        const items = kinds.flatMap((kind) => actions.filter((action) => action.kind === kind));
        if (!items.length) return null;
        const title = entry.resource && group.id === "web" ? "Where it leads" : group.title;
        return (
          <section class="sheet-section" key={group.id} aria-labelledby={`sheet-${group.id}`}>
            <h3 class="overline" id={`sheet-${group.id}`}>{title}</h3>
            <ul class="acts">{items.map((action) => <ActionRow key={action.id} action={action} />)}</ul>
          </section>
        );
      })}
      {actions.length === 0 && framed && (
        <section class="sheet-section">
          <p class="muted">{framedNote(PRODUCT_NAME)}</p>
        </section>
      )}
    </>
  );
}

/** A resource: a link, shown as one. */
function ResourceContent({ entry, actions }: { entry: Entry; actions: Action[] }) {
  const { model } = useServices();
  const { app } = entry;
  const link = actions.find((action) => action.id === "link") ?? null;
  const stated = entry.listings.find((listing) => listing.description) ?? null;
  const statistics = statisticsFor(model, entry);
  return (
    <>
      <header class="sheet-head" data-sheet-grip>
        <AppIcon entry={entry} size={56} />
        <div class="sheet-title">
          <h2 id="sheet-title" tabIndex={-1} dir="auto">{app.name}</h2>
          {link && <p class="sheet-url" dir="ltr">{readableUrl(link.href)}</p>}
          <p class="sheet-meta"><Places entry={entry} /></p>
        </div>
      </header>

      {(stated?.description || app.summary) && (
        <section class="sheet-section">
          {stated?.description
            ? (
              <>
                <Clamped text={stated.description} />
                <p class="credit">From {originName(model, stated.source)}</p>
              </>
            )
            : app.summary && (
              <>
                <p class="sheet-summary" dir="auto">{app.summary.value}</p>
                <p class="credit">From {originName(model, app.summary.origin)}</p>
              </>
            )}
        </section>
      )}

      <NoteEditor entry={entry} />
      <ActionGroups entry={entry} actions={actions} />
      {hasStatistics(statistics) && <StatisticsBlock statistics={statistics} now={model.now} />}

      <section class="sheet-section" aria-labelledby="sheet-listings">
        <h3 class="overline" id="sheet-listings">Who lists it</h3>
        {entry.listings.map((listing, index) => <ListingBlock key={`${listing.source}-${listing.category}-${index}`} listing={listing} entry={entry} />)}
      </section>

      <section class="sheet-section" aria-label="Share">
        <ShareRow entry={entry} />
      </section>
    </>
  );
}

export function SheetContent({ entry }: { entry: Entry }) {
  const { model, platform, framed } = useServices();
  const { app } = entry;
  const actions = actionsFor(app, platform, framed);
  if (entry.resource) return <ResourceContent entry={entry} actions={actions} />;

  const facts = factsFor(model, entry);
  const statistics = statisticsFor(model, entry);
  const chips = termChips(entry);
  const warning = privilegeWarning(entry);
  const author = app.index.find((index) => index.author)?.author ?? null;
  const shared = detailsSource(facts);

  return (
    <>
      <header class="sheet-head" data-sheet-grip>
        <AppIcon entry={entry} size={56} />
        <div class="sheet-title">
          <h2 id="sheet-title" tabIndex={-1} dir="auto">{app.name}</h2>
          <p class="sheet-meta">
            {author && <span class="sheet-author" dir="auto">{author}</span>}
            <Places entry={entry} />
          </p>
        </div>
      </header>

      <section class="sheet-section">
        {chips.length > 0 && (
          <p class="sheet-terms">
            {chips.map((chip) => <span key={chip.key} class={`fchip fchip-${chip.tone}`} title={chip.title}>{chip.key === "paid" ? pricingLabel(entry) : chip.text}</span>)}
          </p>
        )}
        {warning && (
          <p class="sheet-warning" role="note"><Icon name="warn" size={18} /><span>{warning}</span></p>
        )}
        <Described entry={entry} actions={actions} />
      </section>

      <NoteEditor entry={entry} />

      <ActionGroups entry={entry} actions={actions} />

      {hasStatistics(statistics) && <StatisticsBlock statistics={statistics} now={model.now} />}

      <section class="sheet-section" aria-labelledby="sheet-facts">
        <h3 class="overline" id="sheet-facts">Details{shared && <span> · {shared}</span>}</h3>
        <dl class="facts">{facts.map((fact) => <FactRow key={fact.key} fact={fact} shared={shared} />)}</dl>
      </section>

      <details class="sheet-more">
        <summary><span>Sources and credits</span><Icon name="down" size={20} /></summary>
        <div class="sheet-more-body">
          {entry.listings.map((listing, index) => <ListingBlock key={`${listing.source}-${listing.category}-${index}`} listing={listing} entry={entry} />)}
          <IconCredit entry={entry} />
        </div>
      </details>

      <section class="sheet-section" aria-label="Share">
        <ShareRow entry={entry} />
      </section>
    </>
  );
}
