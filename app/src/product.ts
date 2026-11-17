/**
 * The product's name and the sentences that describe it. The name may change
 * before release, so this module is the only place it is spelled: views import
 * it, and the page template and the web app manifest are filled from it at
 * build time (`vite.config.ts`).
 *
 * Storage keys and cache names deliberately do not use it. They are
 * identifiers on users' devices and must survive a rename.
 */

export const PRODUCT_NAME = "Droid Atlas";

/** At most 12 characters: the label under the home-screen icon. */
export const PRODUCT_SHORT_NAME = "Droid Atlas";

export const PRODUCT_DESCRIPTION = "A map of Android apps from curated catalogs, with facts stated by F-Droid, IzzyOnDroid and GitHub.";

/**
 * The installed app's identity in the web app manifest. Browsers treat two
 * manifests with the same id on one origin as the same app, so this is an
 * identifier like the storage prefix: it does not follow the display name and
 * must never change once the site has users.
 */
export const PRODUCT_APP_ID = "droid-atlas";

/** Page and browser-chrome colors per theme: the page's `theme-color`, and the manifest's colors (which can only be the dark ones). */
export const THEME_COLORS = { dark: "#000000", light: "#fbfaf8" } as const;

/** The name as it appears in file names the app hands out ("droid-atlas-export-2026-11-11.json"). */
export const PRODUCT_SLUG = PRODUCT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The project's public repository: its source code, and its issues, where corrections and removal requests are taken. */
export const PRODUCT_REPOSITORY = "https://github.com/yyyyyyyan/droid-atlas";

/** Where a correction or a removal request is filed while the project has no contact address of its own. */
export const PRODUCT_ISSUES = `${PRODUCT_REPOSITORY}/issues`;

/**
 * The project's own address for corrections and removal requests: the text
 * shown, and an `https:` or `mailto:` link to it. Null would send everything
 * that shows it to the repository's issues instead.
 */
export const PRODUCT_CONTACT: { label: string; href: string } | null = { label: "hello@droidatlas.app", href: "mailto:hello@droidatlas.app" };

/** The two self-hosted typefaces, each with the copyright line its license (SIL Open Font License 1.1) asks to be kept. */
export const PRODUCT_FONTS = [
  { name: "Figtree", copyright: "Copyright 2022 The Figtree Project Authors", url: "https://github.com/erikdkennedy/figtree" },
  { name: "Bricolage Grotesque", copyright: "Copyright 2022 The Bricolage Grotesque Project Authors", url: "https://github.com/ateliertriay/bricolage" },
] as const;

/**
 * The one mark of another project that the app draws (`ui/Icon.tsx`): where
 * it was taken from and the copyright line its license (GPL-3.0-or-later)
 * asks to be kept.
 */
export const FDROID_MARK = {
  copyright: "Copyright 2012 William Theaker, 2013 Robert Martinez, 2015 Andrew Nayenko",
  url: "https://gitlab.com/fdroid/artwork/-/tree/master/fdroid-logo-2015",
} as const;

/** Possessive form for running text ("…’s own grouping"). */
export const PRODUCT_NAME_POSSESSIVE = `${PRODUCT_NAME}’s`;
