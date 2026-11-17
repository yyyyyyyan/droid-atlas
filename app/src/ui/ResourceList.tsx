/**
 * A list of resources: guides, sites and further reading, set as a reading
 * list. Each group is one block of rows under its category's name; a row is
 * one link, the whole row, opening in a new tab: the title, the site it leads
 * to on one quiet line (broken after a slash, never inside a name, when a
 * long project name does not fit), and the description where a catalog
 * gives one.
 *
 * A link is not an app: it has no icon and no bookmark. A link saved before is
 * still in Saved, where it can be removed. Rows come in the order the catalog
 * lists them, and there are few, so the list is not windowed.
 */

import { Fragment } from "preact";
import { useEffect } from "preact/hooks";
import type { CategoryView, Entry } from "../catalog/model.ts";
import { resourceLink, siteOf } from "../links.ts";
import { Icon } from "./Icon.tsx";
import { AppLink } from "./Link.tsx";
import { resultSet } from "./results.ts";

interface Props {
  /** The categories to list, each a group. A single group needs no heading: the page's own header names it. */
  groups: readonly CategoryView[];
  label: string;
}

function ReadingRow({ entry }: { entry: Entry }) {
  const { app } = entry;
  const link = resourceLink(app);
  const site = link ? siteOf(link.href) : null;
  const title = app.name.trim() || site || app.id;
  const description = entry.listings.find((listing) => listing.description)?.description ?? app.summary?.value ?? null;
  const body = (
    <>
      <span class="reading-text">
        <span class="reading-title" dir="auto">{title}</span>
        {site && site !== title && (
          <span class="reading-site" dir="ltr">{site.split("/").map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}<span>{index > 0 ? `/${part}` : part}</span></Fragment>)}</span>
        )}
        {description && <span class="reading-sum" dir="auto">{description}</span>}
      </span>
      <Icon name={link ? "external" : "next"} size={18} />
    </>
  );
  return (
    <li data-row={app.id}>
      {link
        ? <a class="reading-row" href={link.href} target="_blank" rel="noopener">{body}<span class="sr">, opens in a new tab</span></a>
        : <AppLink appId={app.id} class="reading-row">{body}</AppLink>}
    </li>
  );
}

export function ResourceList({ groups, label }: Props) {
  const headed = groups.length > 1;

  /* A link opened by its address still shows its sheet; stepping there follows the page, every group in turn. */
  useEffect(() => {
    const ids = groups.flatMap((group) => group.entries.map((entry) => entry.app.id));
    const set = {
      ids,
      reveal(id: string) {
        document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
      },
    };
    resultSet.value = set;
    return () => {
      if (resultSet.peek() === set) resultSet.value = null;
    };
  }, [groups]);

  return (
    <section class="reading" aria-label={label}>
      {groups.map((group) => {
        const { category, entries } = group;
        const headingId = `res-${category.id.replace(/[^A-Za-z0-9]+/g, "-")}`;
        return (
          <div class="reading-group" key={category.id}>
            {headed && <h2 class="overline" id={headingId}>{category.name}</h2>}
            <ul class="reading-block" aria-labelledby={headed ? headingId : undefined}>
              {entries.map((entry) => <ReadingRow key={entry.app.id} entry={entry} />)}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
