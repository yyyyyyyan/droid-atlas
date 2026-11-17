/** When an icon is worth more than the list-size file. */

/** The width, in pixels, of the icon file every list shows and stores. */
export const LIST_ICON_PX = 192;

/**
 * True where an icon drawn `size` CSS pixels wide on a screen of `ratio`
 * device pixels per CSS pixel needs more pixels than the list file has: only
 * there is the large file worth fetching.
 */
export function wantsLargeIcon(size: number, ratio: number): boolean {
  return size * ratio > LIST_ICON_PX;
}
