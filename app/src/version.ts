/**
 * The site's own version: the commit this page's code was built from and
 * that commit's date, as the build that made it knew them. It is not the
 * catalog's hash, which names the data and changes with every refresh; a
 * refresh rebuilds the same commit with new data.
 *
 * Filled in by the build (`vite.config.ts`, from `build/site-version.ts`) and
 * never read at run time.
 */

export interface SiteVersion {
  /** The commit the site was built from, shortened; null when the build could not tell. */
  commit: string | null;
  /** When that commit was made, as an ISO timestamp; null when the build could not tell. */
  date: string | null;
  /** A local checkout with changes that are in no commit. */
  modified: boolean;
  /** The commit's page in the public repository; null unless that repository's own workflow made the build. */
  commitUrl: string | null;
}

declare const __SITE_VERSION__: SiteVersion;

export const SITE_VERSION: SiteVersion = __SITE_VERSION__;
