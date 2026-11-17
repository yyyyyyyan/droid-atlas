# Copy standard

The interface says the least that is true. Every string is held to the rules
below; a writer applies them and a reviewer checks them.

**Why.** People scan: in the classic test, 79 percent of readers scanned a new
page and 16 percent read word by word, and the concise version of the same
page scored 58 percent higher in usability (Nielsen Norman Group). A line that
guards against a misreading is paid for by every reader on every visit.
Machine-drafted text over-explains for two reasons. It is written to be
defensible to anyone instead of useful to someone, so it drifts to what
"applies to the widest variety of cases" (Wikipedia, *Signs of AI writing*),
and it reads "as though it is clearing up a common misconception" nobody
holds. And it is written without the screen in view, so it describes what the
reader is already looking at.

## Rules

Each rule has a check and an example from this app (before → after).

1. **Say nothing the screen already says.** No sentence that restates a
   label, a heading, a value or what a control visibly does.
   *Check:* delete it. If the screen still answers the same questions, it
   stays deleted.
   *"On F-Droid / Present in the official F-Droid repository."* → *"On F-Droid"*
2. **A fact is a label and a value, not a sentence.**
   *Check:* could this be two cells of a table?
   *"Built Nov 13, 2026, 1:28 AM UTC, less than a day ago."* → *"Built · Nov 13, 2026"*
3. **Provenance is a name and a date.** The product promises to say who states
   each fact. A source name, and a date where the fact has one, keep that
   promise in full. Say the source once for a block when its rows share it.
   *Check (the hard case):* cover the line. Does the reader still know who
   states the fact and as of when? Then the line was not provenance; it was
   method or caveat, and rule 4 applies.
   *"F-Droid · 1,366,377 · Jul 28 – Aug 23, 2026 · Requests for the app's APK
   files to F-Droid's own download servers; third-party mirrors are not
   counted, and…"* → *"F-Droid · 1,366,377 · Jul 28 – Aug 23, 2026"*
4. **Method and caveats live once.** How each source counts, and what was
   changed in its data, is on *Sources and licenses*, under that source. How
   old the data is, is on *Data health*. A sheet links there once ("How these
   are counted", at the foot of Statistics). Nothing else repeats either.
   *Check:* search the app for the sentence's key phrase; more than one hit
   fails.
   *"Each source counts its own way over its own period…"* (sheet, sort sheet,
   list, Data health) → one sentence on *Sources and licenses*
5. **Do not answer a question nobody asked.** No "not X", "which is not the
   same as", "never", "only", "nothing here is". A caveat stays when a person
   would act differently for knowing it, and then it sits where they act, in
   under a line.
   *Check:* name the person and the wrong action the line prevents. If you
   cannot, cut it.
   *"…so permissions, anti-features and version details are not shown. Here
   they are unknown, which is not the same as “none”."* → *"Permissions and
   anti-features: unknown"*
6. **Do not explain the interface inside the interface.** If a control needs
   a sentence, the label is wrong; fix the label. No how-to for what one tap
   reveals.
   *Check:* is the sentence about the app instead of about apps?
   *"Compact rows fit more on a screen: the name, then one line of labels and
   summary."* → nothing; the two buttons are the explanation.
7. **Once per screen, not once per item.** Nothing repeats on every row,
   every sheet or every page: an attribution, a license tag, "on this device",
   the unit of a sorted figure.
   *Check:* scroll the screen; any phrase seen three times moves to the header
   or goes.
   Row under a download sort: *"1.5M downloads"* → *"1.5M"* (the list header
   says what and when)
8. **Short, plain, no rhythm for its own sake.** A label is one to three
   words. Supporting text is one sentence of at most 15 words with no
   semicolon or colon clause. Buttons start with a verb. No triples and no
   matched pairs written for balance.
   *"Tap the bookmark on any row, or Save in an app’s details. Saved apps stay
   on this device; nothing is sent anywhere."* → *"Tap the bookmark on an app
   to keep it here."*

## Category names

Droid Atlas names its own categories (`pipeline/taxonomy.ts`); the sources'
names are shown only as the sources' wording, quoted, in an app's sources
block.

- Title case and US English: "Cloud & Sync", never "Synchronisation".
- A category is named for the kind of app, in the plural ("Launchers",
  "Firewalls"), or for the subject when its apps are tools for it ("Finance",
  "Weather", "Backup").
- "&" joins at most two such names ("Battery & Power"). No "and", no commas.
- A device category is named for the maker or the kind of device ("Samsung",
  "Gaming Handhelds").
- A remainder is "Other …" plus what its region holds ("Other Games").
- No category repeats its region's name: "Productivity" over "Productivity"
  reads as a mistake.

*Check:* read the name on a chip with no region beside it. Does it say what
kind of app is inside?

## A source's note

A source may attach a note to one of its categories ("Below, you can find
forks of Shizuku…"). It is the source's wording about the source's own list,
so it is shown, quoted and attributed, only where the page under it is still
that list:

- A note stands on a category's page only while **every entry on the page is
  listed in a source category that carries the note**. Once the page also
  holds apps of the other source, or one placed there by hand, "below" and
  "here" no longer mean what the source meant, and the note is not shown.
- One wording is shown once, however many of the source's categories carry
  it; the line under it names those categories, with their heading where two
  share a name.
- A quoted line that was only a link ("See here more file managers") says
  nothing once the link is text. The pipeline keeps it out of the category's
  note and lists it in the build report.

*Check:* read the note as a stranger to the source. Is each thing it points
at on this page?

## A category among search results

A search that names a category is answered first with the category itself:
its name, then "Category in {region} · {N} apps". The word "Category" is
there so that the row cannot be read as one more app, and the count says what
following it leads to. Where the search found the category by a name a source
gives it, the line ends "· includes “{the source's name}”", in the source's
spelling, so that a person who typed "Synchronization" sees why "Cloud &
Sync" answers.

*Check:* cover the apps below. Does the row alone say where it leads?

## A filter built on someone's statement

"No anti-features" holds the apps an index lists and flags with nothing. An
app neither index lists is absent from it, and from every "With" and
"Without", because nobody has stated anything about it; its sheet says
"Anti-features: Unknown". The count alone does not show that: "No
anti-features · 639" reads as a statement about the whole catalog.

So a filter built on someone's statement says whose statement it is where
its list is shown:

- One line above the rows names who states it and how many apps the list
  leaves out for want of a statement: "F-Droid and IzzyOnDroid flag
  anti-features, so 473 apps listed by neither are left out."
- The number is counted for the list on screen. It follows the search and
  every other filter in force, and the page the list is on. When nothing is
  left out the line names the indexes and stops.
- The Filters panel says it once, under the group's heading and without a
  number: "F-Droid and IzzyOnDroid flag these, so apps listed by neither are
  left out."
- No third choice is added for "unknown", and the filter keeps its name.

This is rule 3's provenance and a caveat rule 5 keeps: a person who takes 639
for the catalog's whole answer takes the other apps for flagged ones.

*Check:* cover the line. Can the reader still tell whose word the list rests
on, and that apps are missing from it?

## What stays

- Who states each fact: a name, and a date where there is one.
- Cautions a person would act on (closed source with privileged access,
  archived, a stale link, anti-features), as a badge, with the detail in
  Details.
- Errors and empty states that say what to do next, in one sentence.
- "How to use it" in About: at most six lines, each saying only what a person
  cannot learn by looking at the screen.
- Notices a license requires (credit, license, changes made). They are not
  copy and are not trimmed; they live on *Sources and licenses* and in a
  sheet's *Sources and credits*, both behind a tap.

## Reviewing a string

Keep, cut, shorten, or move behind a tap, in that order of suspicion: start
from cut. Words that mark a sentence for a second look: *not, never, only,
cannot, so that, which is, its own, itself, every, always*, and any semicolon.
When in doubt, cut, and write down what a person can no longer do. If the
answer is nothing, it goes.

## Read for this standard

- Apple, Human Interface Guidelines, *Writing*: "Check each word to be sure it
  needs to be there. If you can use fewer words, do so."; "If the setting
  label isn’t enough, add an explanation."
- GOV.UK, *Write content to meet user needs*: "Publish only what’s needed to
  meet that user need and nothing more."
- Nielsen Norman Group, *Concise, SCANNABLE, and Objective* (1997), *How
  Users Read on the Web* (1997), *Progressive Disclosure* (2006): "Initially,
  show users only a few of the most important options"; more than two levels
  of disclosure "typically have low usability".
- Microsoft Writing Style Guide, *Top 10 tips*: "Give customers just enough
  information to make decisions confidently."
- Material Design 3, *Style guide*: "People scan UI text in search of the most
  meaningful content to them."
- Mailchimp Content Style Guide: "Give them the exact information they need,
  along with opportunities to learn more."
- Wikipedia, *Signs of AI writing*: negative parallelisms, the rule of three,
  hedging disclaimers, restating summaries. Its own caution applies here too:
  the signs are symptoms, and removing the symptom without removing the
  unneeded sentence fixes nothing.
- Shopify Polaris content guidelines could not be read (moved, no text
  served).
