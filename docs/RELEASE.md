# Release

How Droid Atlas gets from this repository to a public site that refreshes itself
every day, how to get it back when something goes wrong, and how to run a copy
of your own. No workflow publishes or deploys until the switches in
[§3](#3-switches) are set.

Claims are marked: **Measured** (observed for this document, with the date),
**Documented** (the host's current documentation, quoted with its URL; fetched
2026-11-11, and 2026-11-16 for Cloudflare Workers), **Expected** (follows from
the code or the documentation, not observed).

## 1. What is automated

| Piece | File | Runs | Can publish? |
|---|---|---|---|
| Continuous integration | `.github/workflows/ci.yml` | every pull request; pushes to `main` and `next` | No. Read-only token, no secrets |
| Daily refresh | `.github/workflows/refresh.yml` | 04:17 UTC daily and on manual dispatch | Only its deploy jobs, only with the switches set |
| Public export | `scripts/export-public.mjs` | by hand, and in CI as a check | No. Writes a local directory |

### CI

On every change, in one job (about 3–5 minutes expected; the repository's own
unit tests take seconds):

1. `pnpm install --frozen-lockfile`, type-check, the pipeline and app unit
   tests, and the release tooling's tests (`scripts/test/`).
2. **The real pipeline, offline, over a synthetic upstream.**
   `scripts/fixture/upstream-cache.mjs` writes two list repositories with dated
   history, two `index-v2.json` files and a GitHub cache, all invented; the
   pipeline builds them with `--offline --bootstrap --no-icons` into
   `app/public/data`. No upstream is contacted.
3. The app build on that data, the third-party license notice, the site
   assembly checks and a leak scan of the built site (see the refresh, steps
   7–8).
4. The end-to-end suite, when `tests/e2e/` exists (contract in §8).
5. `actionlint` (a pinned release, checked by SHA-256), `reuse lint` on the
   repository, then the public export with its leak scan, and `reuse lint` on
   the exported tree.

A second job, `hooks`, runs the commit hooks of `.pre-commit-config.yaml` on
every file with prek: file hygiene, `typos`, `zizmor` and `actionlint`.
`CONTRIBUTING.md` describes them.

### Daily refresh

Every job is skipped unless `REFRESH_ENABLED` is `true`.

| Job | Token | Does |
|---|---|---|
| `build` | `contents: read` | 1. Checks the switches (`scripts/refresh-config.mjs`): a mistyped value fails the run instead of being read as "off". 2. Unit tests, while the checkout holds no catalog and no upstream cache: they test the code, as in CI, and the tests that read a stored catalog or a filled cache skip. Whether the day's catalog is good is for the validation gates to say. 3. Restores the upstream cache (clones, indexes with their ETags, license texts, icon originals). 4. Mirrors the live build (§5). 5. Runs `node pipeline/build.ts --previous app/public/data`; the pipeline retries each fetch with backoff and its validation gates decide. 6. Saves the cache (also after a failed build, so a retry does not download 85 MB again) and uploads the build report. 7. Builds the app; generates `third-party-licenses.txt` (fails on a license that is unknown or off the allowlist, or on a bundled package that is not a production dependency); assembles the site and checks it is complete. 8. Scans the site for leaks. 9. End-to-end suite against the built site. 10. Uploads the site as an artifact (7 days). |
| `deploy-github-pages` / `deploy-cloudflare-workers` | see §6 | Publishes the artifact. Runs only when `build` succeeded, `DEPLOY_TARGET` names it, and the run is on the default branch |
| `freshness` | `contents: read` | Fails when the live `version.json` is more than 3 days old, or absent |
| `report` | `issues: write` | Opens or updates one issue labeled `refresh-failure`, titled for the failing gate (`Daily refresh failing: validation entries:android-foss`), with the report excerpt; closes it on the next successful run |
| `keepalive` | `actions: write` | Scheduled runs only: re-enables this workflow (§7) |

The GitHub GraphQL enrichment uses the workflow's own `GITHUB_TOKEN`, read-only
(`contents: read`). Documented: "For `GITHUB_TOKEN` in GitHub Actions workflows:
1,000 points per hour per repository"
(https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).
Expected: the pipeline sends about 24 batched queries of 50 repositories, each
costing about one point, so the budget is ample. Not yet measured on a real run.

## 2. Hosts

### 2.1 Host and dedicated origin

Saved apps, the installed app and the service worker belong to the origin, so
the site needs an origin of its own from the first public install
(`ARCHITECTURE.md` § Origin). Both supported hosts can give one; they differ in
cost, accounts and HTTP behavior.

The Cloudflare target is **Workers with static assets**, not Cloudflare Pages:
Cloudflare's Pages documentation says "Start new projects with Workers" and
"Workers supports most Pages use cases and offers a broader feature set"
(Documented, https://developers.cloudflare.com/pages/), and its dashboard now
offers Pages only as the legacy workflow.

| | GitHub Pages | Cloudflare Workers (static assets) |
|---|---|---|
| Dedicated origin | Only with a custom domain, or an organization whose `<org>.github.io` site is this one. A project site lives at "`http(s)://<owner>.github.io/<repositoryname>`", sharing the owner's origin (Documented, https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages) | A custom domain, which the first deploy creates with its DNS record and certificate: "Cloudflare will create DNS records and issue necessary certificates on your behalf" (Documented, https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). The domain's zone must be on Cloudflare: "Unlike Pages, Workers does not support any domain whose nameservers are not managed by Cloudflare" (Documented, https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/). The Worker's `workers.dev` address is switched off, so the site has one origin (§6) |
| Custom headers, `_headers` | Not offered; the documentation describes none. The app's `_headers` file would be served as a plain file. The CSP is a `<meta>` tag, so it still applies | "You may define up to 100 header rules. Each line in the `_headers` file has a 2,000 character limit" (Documented, https://developers.cloudflare.com/workers/static-assets/headers/). The app writes 10 rules, the longest line 148 characters (Measured 2026-11-16), in the syntax the page documents, and nothing Pages-only. Wrangler does not upload `_headers` as a file: it is in its default ignore list with `_redirects` and `.assetsignore` (Measured in `wrangler@4.152.0`'s source; `/_headers` answers 404 under `wrangler dev`) |
| Cache-Control | `cache-control: max-age=600` on every file, with a weak ETag (Measured 2026-11-11 on three Pages sites). `version.json` can therefore be served up to 10 minutes stale; the app's `cache: "no-cache"` revalidates against that | Without a rule, `Cache-Control: public, max-age=0, must-revalidate` and an `ETag` that "is a hash of the static asset file" (Documented, https://developers.cloudflare.com/workers/static-assets/headers/). The app's `_headers` decides instead: `no-cache` for `/`, `version.json`, `sw.js` and the manifest, a year and `immutable` for hashed assets and catalog parts (Measured 2026-11-16 under `wrangler dev` 4.152.0, which runs Cloudflare's asset server locally; the real host is checked as in §4.2) |
| Compression | gzip only; a request offering only Brotli got an uncompressed response (Measured 2026-11-11) | Not described in the static-assets documentation. Brotli under `wrangler dev` (Measured 2026-11-16, locally); on the real host, Expected, unverified |
| Limits | "no larger than 1 GB"; "a *soft* bandwidth limit of 100 GB per month"; "deployments will timeout if they take longer than 10 minutes" (Documented, https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) | 20,000 files per Worker version on the Free plan, 25 MiB per file; "To use the increased file count limits in Wrangler, you must use version 4.34.0 or higher" (Documented, https://developers.cloudflare.com/workers/platform/limits/). The workflow pins 4.152.0. The real build with its predecessor is about 2,300 files. Requests for static assets are free, as on Pages |
| Accounts and secrets | None beyond GitHub. Repository Settings → Pages → Source: "GitHub Actions" | A Cloudflare account with the site's domain as a zone; an account API token with Workers Admin (Editor after the first release) and, for the site's zone, Workers Routes Write (§4.1) stored as the repository secret `CLOUDFLARE_API_TOKEN`; the account id as a secret too, the Worker name as a variable |
| Rollback | No built-in rollback: re-run an earlier run's deploy job (§9) | "You can roll back to a previously deployed version of your Worker using Wrangler or the Cloudflare dashboard"; "You can only roll back to the 100 most recently published versions" (Documented, https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) |

**Recommendation.** Cloudflare Workers, if a Cloudflare account is acceptable
and the domain can move its nameservers to Cloudflare: a dedicated origin at no
cost, `_headers` honored, and revalidation of `version.json` on every load.
GitHub Pages, if no third-party account is wanted; then it **must** be on a
custom domain (or a dedicated organization), never
`<user>.github.io/<repository>`.

Either way, check the real host's headers for `version.json`, a catalog part and
the service worker before announcing the site (§4.2).

### 2.2 A copy under another name

A copy of the site needs its own name, address and contact before it is
published.

- **Name.** It is in `app/src/product.ts` (the title and the manifest are
  filled from it), in the workspace's package names (`@droid-atlas/…`), in
  the pipeline (`split.ts` attribution and header source name,
  `DEFAULT_PROJECT_URL`), and as plain text in `README.md`, `NOTICE.md`,
  `REUSE.toml` and `docs/`, found with `git grep -n "Droid Atlas"`. The
  workflows and release scripts do not contain it: they address the app by
  path (`--filter ./app`), so issue titles, job names and the third-party
  notice ("shipped with this site") stay correct after a rename. The
  `localStorage` prefix `droid-atlas:v1:` must not change once a site has
  users.
- **Contact.** `PRODUCT_CONTACT` in `app/src/product.ts`, which the app shows
  on About, Sources and licenses and Icon credits. The refresh passes the
  same address to the pipeline as `--project-contact`
  (`.github/workflows/refresh.yml`), which names it in the header of
  `icons.json`. `NOTICE.md` and `README.md` name it, and it is in
  `publicContacts` in `scripts/public-export.json`, without which the leak
  scan rejects it.
- **Source address.** `PROJECT_URL` (§3) is the repository's URL. The pipeline
  writes it into the atlas part's header, and the app's source link points
  there. `PRODUCT_REPOSITORY` in `app/src/product.ts` is where About sends
  people for the code and the issues.
- **Licenses.** The code is GPL-3.0-or-later and Droid Atlas's own data and
  configuration are CC0-1.0 (`LICENSING.md` §2.H). `LICENSING.md` §4 lists
  what a published copy must carry.

## 3. Switches

Repository **variables** (Settings → Secrets and variables → Actions →
Variables) unless marked secret.

| Switch | Values | Effect |
|---|---|---|
| `REFRESH_ENABLED` | `true` / unset | The daily refresh runs at all. Anything but `true` skips every job |
| `SITE_URL` | `https://…/` | The live site. Required: the refresh mirrors its build and checks its age |
| `REFRESH_BOOTSTRAP` | `true` / `false` / unset | `true` for the first build only: the pipeline runs `--bootstrap`. Refused while the site already serves a catalog, so it cannot reset permanent ids by accident; remove it after the first deploy |
| `PROJECT_URL` | `https://…` | Passed as `--project-url`. Required before any deploy |
| `DEPLOY_TARGET` | unset / `github-pages` / `cloudflare-workers` | Unset: build, check and upload the site artifact only. Otherwise the named deploy job publishes it |
| `CLOUDFLARE_ACCOUNT_ID` | **secret** | Required with `cloudflare-workers`: the account the Worker lives in. Cloudflare doesn't treat the id as a credential; it is a secret here so that the workflow's public logs mask it |
| `CLOUDFLARE_WORKER_NAME` | lowercase letters, digits, inner dashes; at most 55 | Required with `cloudflare-workers`: the Worker's name, which the first deploy creates. With this target `SITE_URL` must have no path (`https://<domain>/`): its host becomes the Worker's custom domain |
| `CLOUDFLARE_API_TOKEN` | **secret** | Required with `cloudflare-workers`; the only credential anything reads. The build job never sees it |

Repository settings that matter: for GitHub Pages, Pages → Source = "GitHub
Actions". Optionally, protect the `github-pages` or `cloudflare-workers`
environment (the deploy jobs use them) with required reviewers to make every
deploy a manual approval during the first weeks.

## 4. First deploy

For a site that serves nothing yet.

1. **Host.** For GitHub Pages: Pages → Source "GitHub Actions", custom domain
   set and verified, HTTPS enforced. For Cloudflare Workers: the domain added
   to the account as a zone with Cloudflare's nameservers; the API token
   (§4.1); the header check (§4.2). Nothing is created in the dashboard for
   the Worker itself: the first deploy creates it and attaches the domain.
   **The domain's host must not carry a DNS record anyone wants to keep.**
   Run without a terminal, as in Actions, Wrangler 4.152.0 sets
   `override_existing_dns_record` and `override_existing_origin` when it
   attaches a custom domain (Measured in its source), so an existing record
   for that host is replaced without a prompt.
2. **Switches** (§3) in the repository that runs the refresh: `SITE_URL`,
   `PROJECT_URL`, `DEPLOY_TARGET` (and the Cloudflare ones),
   `REFRESH_BOOTSTRAP=true`, `REFRESH_ENABLED=true`.
3. **Run the refresh by hand** (Actions → Daily refresh → Run workflow). The
   mirror step confirms the site has no catalog yet; the pipeline bootstraps;
   the deploy publishes. Approve the environment if protected. On Cloudflare
   Workers the site's host has no address until this first deploy creates its
   DNS record; with `REFRESH_BOOTSTRAP=true` the mirror step takes that as "no
   catalog yet". Any other failure to reach the site stops the run.
4. **Remove `REFRESH_BOOTSTRAP`** (or set `false`). From now on every run
   compares against the live build.
5. **Check the live site**: `node scripts/live-build.mjs age --site <SITE_URL>`;
   the response headers (§2.1); which version is live (below); install it on
   a phone and use it.
6. **Run the refresh by hand once more.** It must pass against the build it
   just published: same ids, no gate tripped.

**Which version is live.** The last line of About, and "This site" on Data
health, give the site's own version: the commit the refresh built from and
that commit's date, for example "Site build a1b2c3d · Nov 17, 2026". After a
release, and after any deploy of new code, that commit must be the
head of the repository's default branch
(`git rev-parse --short=7 origin/main`), and it must be a link that opens
that commit there. Plain text instead of a link means the build did not run
in the repository `PROJECT_URL` names, or `PROJECT_URL` is unset. A daily
refresh changes "Catalog build" on Data health and leaves the commit as it
was. A window still on the previous shell shows the previous commit until its
next load (`ARCHITECTURE.md`, "Offline and updates", rule 6).

### 4.1 The Cloudflare API token

`wrangler deploy` for this site creates an assets-only Worker on its first
run, uploads to it on every run, keeps its `workers.dev` address off and
attaches a custom domain.

Cloudflare changed the permissions of Workers on 2026-09-15
(https://developers.cloudflare.com/workers/authorization/,
https://blog.cloudflare.com/workers-granular-authorization). There are now
four roles, Metadata Read-Only, Content Read-Only, Editor and Admin, granted
for the Workers product or for one Worker. The permissions this section named
before ("Workers Scripts") carry the label Legacy in the dashboard; they map
to the new roles (Workers Scripts Edit to Editor) and "There is no deprecation
date right now. Existing permissions and roles continue to work". What the
guide states (Documented, read 2026-11-17):

- Deploying an existing Worker needs Editor, for that Worker or for the
  Workers product.
- "Creating a new Worker requires product-level `Admin` access." Editor
  "Cannot create or delete Workers".
- Changing routes or custom domains during a deploy needs "`Editor` for that
  Worker, plus `Workers Routes Write` for each affected zone"; for a token,
  "*Zone* > *Workers Routes* > *Write*, scoped to each affected zone".
- "Custom Domains do not currently support per-Worker roles."
- Wrangler uses these roles through an account API token in
  `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`. Workers are on the list
  of products that accept account API tokens
  (https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens),
  which Cloudflare recommends for "credentials that are not associated with
  users". New ones begin with `cfat_`.

The API reference still names the legacy permission for the three calls a
deploy makes, and no zone permission for attaching a domain
(https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/,
https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/,
https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/).
The guide is newer and asks for more, so the token follows the guide. Neither
has been observed: no deploy has run.

The token is an account API token with two permission policies:

| Policy covers | Permission | Why |
|---|---|---|
| The entire account | Developer Platform · Workers · **Admin** for the first release, **Editor** from then on | The first deploy creates the Worker, and §4.2 creates and deletes a throwaway one: both need Admin. Every later deploy updates an existing Worker, which Editor allows, and Editor cannot create or delete one |
| The site's zone only | Zone · **Workers Routes** · Write (the dashboard may say Edit) | Attaching the custom domain during a deploy |

The token cannot be limited to the domain alone: a Worker belongs to the
account, not to a zone, so a token with only a zone policy cannot upload one.
What this token cannot do: read or change DNS, touch any other zone, or use
any product but Workers.

The "Edit Cloudflare Workers" template is the shortcut Cloudflare's GitHub
Actions guide names (https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
but it grants much more: Workers KV Storage and Workers R2 Storage (write),
Workers Tail and Account Settings (read), User Details and User Memberships
(read), and routes on every zone (Documented,
https://developers.cloudflare.com/fundamentals/api/reference/template/). Use a
custom token instead. Steps:

1. In the Cloudflare dashboard, open **Manage Account** → **Account API
   Tokens**. Creating one needs the Super Administrator role.
2. Select **Create Token**, and start from a custom token, not a template.
3. Name it for its use, for example `refresh deploy (GitHub Actions)`.
4. First policy: resources **Entire account**; permission **Developer
   Platform** → **Workers** → **Admin**.
5. Second policy: resources **Specified domains**, the site's domain;
   permission **Workers Routes** → Write.
6. Optionally set an expiration (and put a reminder where it will be seen: an
   expired token fails the deploy and opens the refresh issue). Leave the
   client IP filter empty: GitHub's runners have no fixed address.
7. On the summary, check that it lists those two policies and nothing else,
   and create the token.
8. Copy the secret at once: it is shown only once. Store it in the public
   repository as the secret `CLOUDFLARE_API_TOKEN` (Settings → Secrets and
   variables → Actions; or in the `cloudflare-workers` environment, to scope
   it to the deploy job).
9. Copy the account id from **Workers & Pages** → **Account Details** →
   **Account ID** (https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)
   into the secret `CLOUDFLARE_ACCOUNT_ID`.
10. **After the first release** (§4 step 6 passed): edit the token and change
    Workers from Admin to Editor. Editing permissions keeps the secret. Run
    the refresh by hand once more; it must deploy with Editor.

Narrowing the first policy further, to the one Worker ("Specified Workers"),
is possible once the Worker exists. The guide's line on custom domains above
leaves open whether a deploy that carries a custom domain passes with a
per-Worker role. Try it only with a refresh run by hand straight after, and
go back to Editor for the Workers product if that run fails.

### 4.2 Checking the headers before the first release

The headers the site is served with come from its `_headers` file, which the
app build writes. Before the real domain serves anything, check them on a
throwaway copy at a `workers.dev` address. This is a public deploy for a few
minutes. It needs Wrangler
logged in to the account (`npx --yes wrangler@4.152.0 login`, or
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set to the §4.1 token
while it still carries Admin: the copy is a Worker created and deleted) and
the account's `workers.dev` subdomain, shown under **Workers & Pages** →
**Your subdomain** (https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

From a checkout with a built site (`pnpm build && pnpm site`), one command
writes the preview configuration and deploys it as the Worker
`<name>-preview`, with no domain and nothing shared with the real Worker:

```sh
CLOUDFLARE_WORKER_NAME=<name> SITE_URL=https://<domain>/ node scripts/wrangler-config.mjs --preview --assets app/dist --out /tmp/wrangler-preview.json && npx --yes wrangler@4.152.0 deploy --config /tmp/wrangler-preview.json
```

Wrangler prints the address,
`https://<name>-preview.<subdomain>.workers.dev`. Read the headers:

```sh
for p in / data/version.json sw.js manifest.webmanifest; do curl -sI -H 'Accept-Encoding: br, gzip' "https://<name>-preview.<subdomain>.workers.dev/$p"; done
```

and once more for one file under `assets/` and one under `data/c/`. Expected,
as measured under `wrangler dev` on 2026-11-16:

| Path | Status | `Cache-Control` |
|---|---|---|
| `/`, `/data/version.json`, `/sw.js`, `/manifest.webmanifest` | 200 | `no-cache` |
| `/assets/…`, `/data/c/…` | 200 | `public, max-age=31536000, immutable` |
| `/index.html` | 307 to `/` | `no-cache` |
| `/_headers`, any missing file | 404 | none |

Every response also carries the `Content-Security-Policy` (ending
`frame-ancestors 'none'`), `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`, and an `ETag`. Note the `Content-Encoding`:
whether the real host serves Brotli is not documented. Then delete the copy:

```sh
npx --yes wrangler@4.152.0 delete <name>-preview
```

Without an account, the same check runs locally against Cloudflare's asset
server: write the configuration as above (with or without `--preview`) and
run `npx --yes wrangler@4.152.0 dev --config /tmp/wrangler-preview.json`, then
read the headers from `http://localhost:8787`. That is how the table above was
measured; it does not prove what the real host adds.

## 5. Last-known-good

- **What users have is the baseline.** The refresh does not trust its own
  cache for the previous build. `scripts/live-build.mjs mirror` downloads the
  live `version.json`, its manifest and every file the manifest lists, every
  icon the atlas names, and the license texts, and checks each against the
  manifest's SHA-256 (icons against the hash in their name). The pipeline then
  runs with `--previous` on that copy, so its gates (counts, coverage, id churn)
  and its permanent ids compare against exactly what is live.
- **The previous build stays published.** The mirror is the pipeline's output
  directory; the pipeline keeps the previous build's directory beside the new
  one and removes anything older. A client still reading yesterday's details
  shards or icons is not left with dead links. Builds older than that are gone
  after the next deploy; license texts of both builds are kept.
- **Nothing partial is published.** A failed fetch, parse, gate, test or check
  fails `build`; the deploy jobs only run after a successful `build`, so the
  live catalog does not change. The failure opens the issue (§1) and the
  report is attached to the run.
- **Staleness is loud.** If refreshes keep failing, `freshness` fails from the
  fourth day and the issue says so.

### Accepting a legitimate change

When an upstream change is real (a list removed a section, a source was
reorganized), a comparison gate fails with the exact value it measured; the
issue quotes it, for example

```
entries:android-foss: 789 → 700 entries (accept with {"gate": "entries:android-foss", "value": 700} in accepted-baseline.json)
```

1. Confirm upstream that the change is intended (the report in the run's
   `report` artifact lists what changed).
2. Add the entry to `pipeline/accepted-baseline.json`, with the date and the
   reason:
   `{"gate": "entries:android-foss", "value": 700, "date": "2026-12-01", "reason": "upstream moved the Tools section to a separate list"}`.
3. Merge it through a pull request, then run the refresh by hand. The build
   records that the baseline entry was used; it accepts exactly that value, so
   a further drop fails again.

Hard gates (schema, invariants, enrichment failures, round trip, icon records,
license texts) cannot be accepted: they are fixed in the pipeline or upstream.

## 6. Deploy targets

**GitHub Pages** (`deploy-github-pages`): downloads the site artifact,
`actions/upload-pages-artifact`, `actions/deploy-pages`. Token: `pages: write`
and `id-token: write`, which the documentation requires: "The job must have a
minimum of `pages: write` and `id-token: write` permissions"
(https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Environment `github-pages`.

**Cloudflare Workers** (`deploy-cloudflare-workers`): fails at once if
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_WORKER_NAME` is
missing. It then checks out `scripts/` only, downloads the site artifact, and
writes the Wrangler configuration with `scripts/wrangler-config.mjs`, which
reads the Worker's name and `SITE_URL` from the variables, so no domain is
committed anywhere. Last it runs
`npx wrangler@4.152.0 deploy --config <that file> --message "refresh <sha>"`.
Token: `contents: read` for the checkout. Environment `cloudflare-workers`,
where the secret can be scoped. The configuration:

| Field | Value | Why |
|---|---|---|
| `name` | `CLOUDFLARE_WORKER_NAME` | The first deploy creates the Worker of that name |
| (no `main`) | | "The `main` key is optional for assets-only Workers" (Documented, https://developers.cloudflare.com/workers/wrangler/configuration/). Every request is answered from the site directory, and `_headers` applies to all of them, since it applies to asset responses only (https://developers.cloudflare.com/workers/static-assets/headers/) |
| `compatibility_date` | `2026-10-01` | Required for every Worker; it picks the runtime version (same configuration page). No later than the pinned Wrangler's release, 2026-10-22 |
| `assets.directory` | the downloaded site | `pages_build_output_dir` becomes `assets.directory` (Documented, https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) |
| `assets.html_handling` | `auto-trailing-slash` | The default, stated explicitly. `/index.html` answers 307 to `/` (Documented for subdirectories at https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/; Measured for the root under `wrangler dev`). The service worker already asks for the page by its directory and strips a redirect's flag (`app/src/sw/sw.ts`) |
| `assets.not_found_handling` | `none` | A missing file is a 404. `single-page-application` would answer every missing path, `data/version.json` included, with `index.html` and status 200, which would fool the mirror's "the site has no catalog yet" check and serve HTML where JSON is expected. The app routes in the hash, so it needs no fallback |
| `routes` | `[{ "pattern": "<SITE_URL's host>", "custom_domain": true }]` | The custom domain, created with its DNS record and certificate by the first deploy (https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). A custom domain is a whole host, with no path or wildcard, hence `SITE_URL` without a path |
| `workers_dev` | `false` | The site is served on its own domain only. A second origin would serve the same app with its own storage and its own install, and could be found and saved by people. The first headers check uses a separate throwaway Worker instead (§4.2) |
| `preview_urls` | `false` | Version URLs are `workers.dev` addresses: "You cannot configure Version URLs to run on a subdomain other than `workers.dev`", and "When enabled, Version URLs are publicly available" (Documented, https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) |

Cloudflare's own "Connect GitHub" builds are not used: they deploy on every
push, have no schedule, and would bypass the refresh's checks and the
last-known-good rule (§5).

Both are complete but inert: neither runs unless `DEPLOY_TARGET` names it,
`REFRESH_ENABLED` is `true`, the run is on the default branch and `build`
succeeded. `scripts/test/workflows.test.mjs` fails if any of those guards is
removed, if any other job gains a publishing permission or secret, or if an
action is not pinned to a commit.

## 7. Keeping the schedule alive

Documented: "In a public repository, scheduled workflows are automatically
disabled when no repository activity has occurred in 60 days"
(https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow).
A catalog that refreshes itself is exactly a repository that can go 60 days
without a commit.

**Mechanism.** The `keepalive` job calls the REST endpoint
`PUT /repos/{owner}/{repo}/actions/workflows/refresh.yml/enable` on every
scheduled run, with a token limited to `actions: write`. It creates no commit,
branch, issue or notification. Documented: the endpoint "Enables a workflow and
sets the state of the workflow to active"
(https://docs.github.com/en/rest/actions/workflows).

**Unverified.** GitHub does not document that enabling an already-enabled
workflow resets the 60-day counter, nor which fine-grained permission the
endpoint needs (the page names only the classic `repo` scope). Third-party
keep-alive actions have relied on this endpoint; the best-known one's
repository is now disabled and could not be read. So:

- Watch the first 60 quiet days. If the Actions tab shows the workflow as
  disabled for inactivity, re-enable it there; the site keeps
  serving the last good catalog meanwhile, and the app shows its date.
- If the endpoint proves not to reset the counter, the alternatives, in order
  of preference: (a) run the refresh from a **private** repository, where the
  rule does not apply, with the public repository as the source of truth for
  code (costs metered minutes: about 10 minutes a day expected); (b) a
  scheduled trigger outside GitHub (for example a Cloudflare Cron Trigger)
  calling `workflow_dispatch`, which needs a token with `actions: write` stored
  outside GitHub; (c) a monthly empty commit, which is the noise this design
  avoids.

The `freshness` job cannot raise the alarm once the schedule itself is
disabled; the app's "catalog as of" date is the visible signal.

## 8. End-to-end suite contract

CI and the refresh run the suite when `tests/e2e/package.json` exists:

- the package is a workspace member (listed in `pnpm-workspace.yaml`);
- it depends on `@playwright/test`, and `pnpm --filter ./tests/e2e exec playwright install --with-deps chromium` installs its browser;
- `pnpm run test:e2e` (root) runs it through its own `test` script;
- it serves and tests the static site directory in the environment variable
  `E2E_SITE_DIR` (an assembled site with `index.html` and `data/`), from its own
  local static server, and needs no network.

## 9. Rollback

Stop further refreshes first if the problem is the data: set
`REFRESH_ENABLED` to anything but `true`.

- **Bad data or app, GitHub Pages.** Open an earlier successful run of Daily
  refresh (its `site` artifact is kept 7 days) and re-run its
  `deploy-github-pages` job. Expected: the site returns to that build, since
  the job publishes the artifact of its own run; not yet exercised.
- **Bad data or app, Cloudflare Workers.** Dashboard → the Worker →
  **Deployments** → the three-dot menu on the last good version → **Rollback**;
  or `npx --yes wrangler@4.152.0 rollback <version-id> --name <worker>`
  (Documented, https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/;
  the last 100 versions only). Each version has its own asset manifest
  (https://developers.cloudflare.com/workers/static-assets/), so a rollback
  should bring that version's files back too; Expected, not exercised.
- **Bad code.** Revert the commit on `main`, wait for CI, run the refresh by
  hand.
- **After a rollback**, the next refresh mirrors the rolled-back build and
  compares against it, so ids carry forward from the build users have.
  Clients that already took the bad build switch to the restored one at their
  next launch (a different hash is a new build to them). Saved apps whose id
  existed only in the bad build fall back as the app's redirect handling
  allows.
- **A leak.** Rotate any exposed secret first; then remove it from the public
  repository. Rewriting history does not un-publish it.

## 10. Not verified

As of 2026-11-17:

- No workflow has run on GitHub: both pass `actionlint` and their policy tests,
  and every script they call has run locally, but GitHub's runners, caches,
  artifacts, Pages and environments have not been exercised.
- The keep-alive's effect on the 60-day counter (§7).
- The GraphQL budget on a real run (§1).
- The Cloudflare deploy. `wrangler@4.152.0 deploy --dry-run` reads the
  generated configuration and the assembled site and exits 0 with no
  credentials, and `wrangler dev` serves the site with the headers of §4.2
  (both Measured 2026-11-16). Neither touches an account. Only a real first
  deploy proves that the Worker is created, that the custom domain, its DNS
  record and its certificate are attached with no dashboard step, that the
  §4.1 token is enough, that `workers.dev` stays off, and what the real host
  adds (compression, `CF-Cache-Status`).
- Response headers of the chosen host for this site (§2.1 measured other
  GitHub Pages sites, and Cloudflare's asset server locally).
