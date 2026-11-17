/**
 * The site's own version in words: the commit it was built from, a link to
 * the commit's page where the build could vouch for one
 * (`build/site-version.ts`) and plain text everywhere else, then the
 * commit's date. Nothing for a build that could not tell its commit.
 */

import { formatDay, parseTime } from "../lib/format.ts";
import type { SiteVersion } from "../version.ts";

export function SiteCommit({ site, join }: { site: SiteVersion; join: string }) {
  if (site.commit === null) return null;
  const commit = <code>{site.commit}</code>;
  const date = parseTime(site.date);
  return (
    <>
      {site.commitUrl ? <a href={site.commitUrl} target="_blank" rel="noopener">{commit}</a> : commit}
      {date !== null && `${join}${formatDay(date)}`}
      {site.modified && ", with local changes"}
    </>
  );
}
