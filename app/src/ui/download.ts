/**
 * Handing the reader a file the app made, and reading one back.
 *
 * A download is a temporary `blob:` URL followed through a real `<a download>`,
 * which works in a browser tab and in the installed app alike. Where the
 * platform can share files, the same file can go to the share sheet instead:
 * the direct way to another device or a cloud folder on a phone.
 */

export function downloadText(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  /* The download reads the blob after the click returns, so the URL is released a little later rather than at once. */
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The export as a file the share sheet accepts, or null where files cannot be
 * shared. Chrome for Android shares only a short list of file types; JSON is
 * not on it, and `canShare` says yes to it all the same, so the share is
 * refused only once the sheet is asked for, when the tap that allowed it has
 * been spent. The same content goes as plain text first, which every browser
 * that shares files takes; the importer reads either.
 */
export function shareableFile(name: string, text: string): File | null {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function" || typeof File !== "function") return null;
  const candidates = [
    new File([text], name.replace(/\.json$/, ".txt"), { type: "text/plain" }),
    new File([text], name, { type: "application/json" }),
  ];
  return candidates.find((file) => {
    try {
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  }) ?? null;
}

export type ShareOutcome = "shared" | "canceled" | "failed";

export async function shareFile(file: File, title: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "canceled" : "failed";
  }
}

/** Reads a chosen file as text, refusing one larger than `maxBytes` before any of it is loaded. Null means it was refused or unreadable. */
export async function readTextFile(file: File, maxBytes: number): Promise<string | null> {
  if (file.size > maxBytes) return null;
  try {
    return await file.text();
  } catch {
    return null;
  }
}
