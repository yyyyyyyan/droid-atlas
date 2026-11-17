# Contributing

This page explains where a correction belongs and how to change the code.
Outside pull requests are welcome.

## Correct an entry

Droid Atlas shows what its sources state, so most corrections belong at the
source. The next daily build picks them up.

| What is wrong | Where to report it |
|---|---|
| An app's name, link, description or tags | The list that has the entry: [Android FOSS](https://github.com/offa/android-foss) or [awesome-shizuku](https://github.com/timschneeb/awesome-shizuku) |
| An app is missing | The same lists. Droid Atlas adds no apps of its own |
| A summary, license, anti-feature or version | [F-Droid](https://f-droid.org) or [IzzyOnDroid](https://apt.izzysoft.de/fdroid/), whichever the app's details name |
| An app is in the wrong category or region | [This repository's issues](https://github.com/yyyyyyyan/droid-atlas/issues/new/choose) |
| Two entries are one app, or one entry mixes two apps | This repository's issues |
| The source is right and Droid Atlas shows it wrong | This repository's issues |

[docs/TAXONOMY.md](docs/TAXONOMY.md) lists every category, and every app
placed by hand with the reason for its place.

To ask for an app's icon to be removed, or to raise a licensing question,
write to hello@droidatlas.app. [NOTICE.md](NOTICE.md) has the details.

## Report a bug

[Open an issue](https://github.com/yyyyyyyan/droid-atlas/issues/new/choose)
and choose the form for a problem in the app. The form asks for your browser,
your device and the steps that cause the problem.

To report a security problem, follow [SECURITY.md](SECURITY.md) instead.

## Set up

You need Node.js 24 or later and [pnpm](https://pnpm.io/).

1. Clone the repository.
2. Run `pnpm install`.
3. Build a catalog. Choose one:
   - A small invented catalog, with no network access:

     ```sh
     node scripts/fixture/upstream-cache.mjs --out .cache/sample
     node pipeline/build.ts --offline --bootstrap --cache .cache/sample
     ```

   - The real catalog. This downloads the two lists and the F-Droid and
     IzzyOnDroid indexes, about 85 MB together, and queries GitHub. It needs a
     GitHub token in `GITHUB_TOKEN`, or a login with the GitHub CLI:

     ```sh
     pnpm run data --bootstrap
     ```

4. Run `pnpm run dev`, then open `http://127.0.0.1:4320/`.

After the first real build, drop `--bootstrap`: later builds compare
themselves with the previous one.

## Check your work

| Command | What it does |
|---|---|
| `pnpm run typecheck` | Type-checks every package |
| `pnpm run test` | Runs the pipeline and app unit tests |
| `pnpm run test:release` | Runs the tests for the release tooling in `scripts/` |
| `pnpm run build` | Builds the app into `app/dist/` |
| `pnpm run site` | Checks that the built site is complete and within its size budget |
| `pnpm run test:e2e` | Runs the end-to-end suite against the built site |

Continuous integration runs the same commands on every pull request.

## Install the commit hooks

[prek](https://github.com/j178/prek) runs checks each time you commit and each
time you push. `.pre-commit-config.yaml` lists them.

1. Install prek and [pipx](https://pipx.pypa.io/). The license check runs
   through pipx.
2. Run `prek install` in your clone.

On each commit, prek runs:

- Fixes for trailing spaces, line endings and the last line of a file.
- Syntax checks for YAML and JSON.
- Checks for large files, private keys and merge conflict markers.
- A spelling check, `typos`.
- `actionlint` and `zizmor` on the workflows.

On each push, prek runs the same checks on the files you push, and two more:

- `pnpm run typecheck`.
- The license check, `reuse lint`.

A check that fixes a file stops the commit. Add the fixed file, then commit
again.

The spelling check reports a word and changes nothing. If the word is right,
such as an app's name, add it to `_typos.toml` with a comment that says why.

To run the commit checks on every file, run `prek run --all-files`. To run the
push checks, run `prek run --all-files --stage pre-push`. Continuous
integration runs the commit checks on every pull request.

## Find your way around

- `pipeline/` turns the sources into the catalog.
  [pipeline/NOTES.md](pipeline/NOTES.md) documents every option and stage.
- `app/` is the web app. [app/README.md](app/README.md) describes it.
- `schema/` is the catalog format that both sides share.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) gives the rules the parts
  follow.
- [docs/COPY.md](docs/COPY.md) is the standard for every string in the app.

## Write for readers

The public documents and the app's text follow three sources. When two
disagree, the earlier one wins:

1. [docs/COPY.md](docs/COPY.md), the project's rules for text in the app.
2. The six rules below.
3. The [Google developer documentation style guide](https://developers.google.com/style).

The six rules:

1. **Reader.** Write for someone who wants apps, not for a developer. Define a
   developer term, or move it to this file.
2. **Tone.** Follow GOV.UK's
   [Use the right tone](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/right-tone/)
   and
   [Use clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)
   in place of Google's "conversational and friendly". State facts. Leave out
   adjectives that praise.
3. **Subject.** Write "Droid Atlas", never "we".
4. **Spelling.** Use US English. GOV.UK's A to Z style guide doesn't apply.
5. **Sentences.** Split a sentence that runs over 25 words.
6. **README order.** Say what Droid Atlas is and how to get it. Then say where
   the data comes from and what its limits are. Then say how to contribute.
   State each caveat once.

## Before you open a pull request

- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit
  messages, for example `fix: keep the sheet open on rotate`.
- Add a test for a change in behavior.
- Add a dependency only with a reason in the commit that adds it.
- Write interface text in US English, to the standard in `docs/COPY.md`.
- Never write a fact about an app by hand. Every fact comes from a source.

Your contribution is licensed under the license of the files it changes.
[REUSE.toml](REUSE.toml) says which license that is. A new kind of file needs
an entry there.
