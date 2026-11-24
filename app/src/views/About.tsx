/**
 * Sources and licenses: where everything on the site comes from, under which
 * license, what was changed, and where the full texts and the raw files are.
 * The source blocks are generated from the loaded build (`catalog/credits.ts`);
 * the statements about the project itself are the ones docs/LICENSING.md asks
 * the app to show.
 *
 * Names of other projects are used as words to identify them. The one mark
 * of another project in the app is F-Droid's, redrawn where its license
 * allows (`ui/Icon.tsx`); its credit is among the project's own statements
 * here.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { DOWNLOAD_MEANING } from "../catalog/schema.ts";
import { licenseIds, licensesMentioned, licenseTextPath, projectUrl, sourceCredits, type SourceCredit } from "../catalog/credits.ts";
import { levelsNote } from "../catalog/permissions.ts";
import { byteSize, formatDateTime, formatDay, licenseName, parseTime } from "../lib/format.ts";
import { FDROID_MARK, PRODUCT_CONTACT, PRODUCT_FONTS, PRODUCT_ISSUES, PRODUCT_NAME, PRODUCT_REPOSITORY } from "../product.ts";
import { aboutRoute, licenseRoute } from "../router/route.ts";
import { useServices } from "../services.ts";
import { useAvailable } from "../ui/available.ts";
import { ContactAddress } from "../ui/Contact.tsx";
import { Icon } from "../ui/Icon.tsx";
import { PageHead } from "../ui/LevelHead.tsx";
import { RouteLink } from "../ui/Link.tsx";
import { Prose } from "../ui/Whole.tsx";

function External({ href, children }: { href: string; children: ComponentChildren }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

/**
 * A license by name, linked to its full text: the one this site ships,
 * shown inside the app, else the license's own page when the source names one.
 */
function License({ id, texts, dataRoot, page = null }: { id: string; texts: ReadonlySet<string>; dataRoot: string; page?: string | null }) {
  const path = licenseTextPath(id);
  const url = path ? dataRoot + path : null;
  if (url && texts.has(url)) return <RouteLink route={licenseRoute(id)}>{licenseName(id)}</RouteLink>;
  return page ? <External href={page}>{licenseName(id)}</External> : <>{licenseName(id)}</>;
}

/** A published data file. It is a file to keep, not a page to read, so the link downloads it, and says so before it is tapped. */
function FileLink({ file }: { file: { url: string; name: string; bytes: number } }) {
  return (
    <a href={file.url} download={file.name.split("/").pop()} class="file-link">
      <Icon name="store" size={15} />Download {file.name} ({byteSize(file.bytes)})
    </a>
  );
}

/**
 * @param counts what this source's download figures count, for a source that publishes any
 */
function CreditBlock({ credit, texts, dataRoot, counts = null, levels = null }: { credit: SourceCredit; texts: ReadonlySet<string>; dataRoot: string; counts?: string | null; levels?: string | null }) {
  const ids = licenseIds(credit.license);
  const mentioned = ids.length ? [] : licensesMentioned(credit.attribution);
  const asOf = parseTime(credit.asOf);
  const data = credit.files.filter((file) => file.kind === "data");
  const upstream = credit.files.filter((file) => file.kind === "upstream");
  return (
    <article class="credit-block" aria-labelledby={`credit-${credit.origin}`}>
      <h3 id={`credit-${credit.origin}`} dir="auto">{credit.url ? <External href={credit.url}>{credit.title}</External> : credit.title}</h3>
      <p class="credit-line" dir="auto">{credit.attribution}</p>
      <dl class="credit-facts">
        <div>
          <dt>License</dt>
          <dd>
            {ids.length > 0
              ? ids.map((id, index) => <span key={id}>{index > 0 && " · "}<License id={id} texts={texts} dataRoot={dataRoot} page={ids.length === 1 ? credit.licenseUrl : null} /></span>)
              : credit.license === "NOASSERTION" ? "Facts; no license is asserted over them" : "Stated per record"}
            {mentioned.length > 0 && (
              <span class="credit-sub">
                Full texts: {mentioned.map((id, index) => <span key={id}>{index > 0 && ", "}<License id={id} texts={texts} dataRoot={dataRoot} /></span>)}
              </span>
            )}
          </dd>
        </div>
        {credit.commit && (
          <div>
            <dt>Commit</dt>
            <dd>
              {credit.commitUrl ? <External href={credit.commitUrl}><code>{credit.commit.slice(0, 10)}</code></External> : <code>{credit.commit.slice(0, 10)}</code>}
              {asOf !== null && ` of ${formatDay(asOf)}`}
            </dd>
          </div>
        )}
        {!credit.commit && asOf !== null && (
          <div><dt>{credit.origin === "github" ? "Fetched" : "Index of"}</dt><dd>{formatDateTime(asOf)}</dd></div>
        )}
        {credit.entries !== null && <div><dt>Entries</dt><dd>{credit.entries.toLocaleString("en")}</dd></div>}
        {credit.changes && <div><dt>Changes</dt><dd dir="auto">{credit.changes}</dd></div>}
        {counts && <div><dt>Downloads</dt><dd>{counts}</dd></div>}
        {levels && <div><dt>Levels</dt><dd>{levels}</dd></div>}
        {data.length > 0 && (
          <div>
            <dt>Data file</dt>
            <dd>{data.map((file) => <FileLink key={file.url} file={file} />)}</dd>
          </div>
        )}
        {upstream.length > 0 && (
          <div>
            <dt>Made from</dt>
            <dd class="credit-files">
              {upstream.map((file) => <FileLink key={file.url} file={file} />)}
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

export function AboutSources() {
  const { build, model, navigation } = useServices();
  const credits = sourceCredits(build);
  const catalogs = credits.filter((credit) => credit.group === "catalog");
  const facts = credits.filter((credit) => credit.group === "facts");
  const own = credits.find((credit) => credit.group === "own") ?? null;
  const iconsFile = build.manifest.files.find((file) => file.role === "icons") ?? null;
  const source = projectUrl(build);
  const generated = parseTime(model.catalog.generatedAt);
  const countsOf = (origin: string): string | null =>
    ((origin === "fdroid" || origin === "izzy" || origin === "github") && model.downloadSources.some((publisher) => publisher.origin === origin) ? DOWNLOAD_MEANING[origin] : null);
  const at = navigation.value.route.params.at;
  const factsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (at === "facts") factsHeading.current?.scrollIntoView({ block: "start" });
  }, [at]);

  const wanted = new Set<string>(["GPL-3.0-or-later", "CC0-1.0"]);
  for (const credit of credits) {
    for (const id of [...licenseIds(credit.license), ...licensesMentioned(credit.attribution)]) wanted.add(id);
  }
  const thirdParty = new URL("./third-party-licenses.txt", document.baseURI).href;
  const licenseUrls = [...wanted].map((id) => licenseTextPath(id)).filter((path): path is string => path !== null).map((path) => build.dataRoot + path);
  const available = useAvailable([...licenseUrls, thirdParty]);
  const hasThirdParty = available.has(thirdParty);
  const shared = { texts: available, dataRoot: build.dataRoot };

  return (
    <div class="view view-page">
      <PageHead title="Sources and licenses" />
      <div class="page">
        <ul class="settings-links">
          <li>
            <RouteLink route={aboutRoute("health")} class="nav-row">
              <span>Data health</span>
              {generated !== null && <span class="nav-row-meta">{formatDay(generated)}</span>}
              <Icon name="next" size={20} />
            </RouteLink>
          </li>
          <li>
            <RouteLink route={aboutRoute("icons")} class="nav-row">
              <span>Icon credits</span>
              <span class="nav-row-meta">{model.entries.filter((entry) => entry.app.icon).length.toLocaleString("en")}</span>
              <Icon name="next" size={20} />
            </RouteLink>
          </li>
        </ul>

        <section aria-labelledby="about-catalogs">
          <h2 class="overline" id="about-catalogs">Catalogs</h2>
          {catalogs.map((credit) => <CreditBlock key={credit.origin} credit={credit} {...shared} />)}
        </section>

        <section aria-labelledby="about-facts">
          <h2 class="overline" id="about-facts" ref={factsHeading}>Facts and descriptions</h2>
          {facts.map((credit) => (
            <CreditBlock key={credit.origin} credit={credit} counts={countsOf(credit.origin)} levels={credit.origin === "android" && build.android ? levelsNote(build.android) : null} {...shared} />
          ))}
          {facts.some((credit) => countsOf(credit.origin) !== null) && <p class="page-text">Each source counts in its own way over its own period.</p>}
        </section>

        <section aria-labelledby="about-icons">
          <h2 class="overline" id="about-icons">App icons</h2>
          <p class="page-text">
            From each app’s listing, repository or website, resized and otherwise unchanged. Each remains its owners’ work
            {iconsFile ? <>: <RouteLink route={aboutRoute("icons")}>Icon credits</RouteLink>.</> : "."}
          </p>
        </section>

        <section aria-labelledby="about-own">
          <h2 class="overline" id="about-own">{PRODUCT_NAME} itself</h2>
          <dl class="credit-facts">
            <div>
              <dt>Code</dt>
              <dd>
                <License id="GPL-3.0-or-later" {...shared} />.{" "}
                <External href={source ?? PRODUCT_REPOSITORY}>Source code</External>
              </dd>
            </div>
            <div>
              <dt>Our own data</dt>
              <dd>
                Which listings are the same app, the regions and categories, and the computed facets: <License id="CC0-1.0" {...shared} />.
                {own?.files[0] && <> <FileLink file={own.files[0]} /></>}
              </dd>
            </div>
            <div>
              <dt>Typefaces</dt>
              <dd>
                {PRODUCT_FONTS.map((font) => (
                  <span class="credit-sub" key={font.name}><External href={font.url}>{font.name}</External>: {font.copyright}. SIL Open Font License 1.1.</span>
                ))}
              </dd>
            </div>
            <div>
              <dt>Icons</dt>
              <dd>
                The F-Droid mark on the “On F-Droid” filter is redrawn in one color from the <External href={FDROID_MARK.url}>F-Droid logo</External>: {FDROID_MARK.copyright}. <License id="GPL-3.0-or-later" {...shared} />.
              </dd>
            </div>
            <div>
              <dt>Software</dt>
              <dd>
                {hasThirdParty
                  ? <>The libraries and typefaces shipped with this site, with their license texts: <RouteLink route={aboutRoute("notices")}>third-party licenses</RouteLink>.</>
                  : "Built with Preact, Preact Signals and lean-qr (MIT). This copy of the site was assembled without its third-party license notice."}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="about-names">
          <h2 class="overline" id="about-names">Names and trademarks</h2>
          <p class="page-text">
            <Prose>{`Android™ is a trademark of Google LLC. ${PRODUCT_NAME} is an independent project, not affiliated with or endorsed by Google, GitHub, F-Droid, IzzyOnDroid, the maintainers of the catalogs it reads, or the developers of the apps listed.`}</Prose>
          </p>
          <p class="page-text">
            <Prose>F-Droid, IzzyOnDroid, Google Play, GitHub, Shizuku and Obtainium are named only to say what a link or a fact refers to. The one logo used is F-Droid’s, redrawn in one color under GPL-3.0 or later.</Prose>
          </p>
        </section>

        <section aria-labelledby="about-contact">
          <h2 class="overline" id="about-contact">Corrections and removal</h2>
          <p class="page-text">
            {PRODUCT_CONTACT ? <>Write to <ContactAddress contact={PRODUCT_CONTACT} />.</> : <><External href={PRODUCT_ISSUES}>Open an issue on the project’s GitHub</External>.</>}{" "}
            Report a catalog’s own error to that catalog too.
          </p>
          <p class="page-text">Everything here is provided without warranty. A listing is a catalog’s statement, not a recommendation or a safety check.</p>
        </section>
      </div>
    </div>
  );
}
