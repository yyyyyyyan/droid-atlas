/**
 * Whether the app can be installed from here, and whether it already is.
 *
 * Chromium announces that a page is installable with `beforeinstallprompt`,
 * once, soon after load, and only when it has decided the page qualifies. The
 * event is kept so Settings can offer installation at a moment of the reader's
 * choosing. Other browsers never fire it. A tab of a browser that also has the
 * app installed learns that from `getInstalledRelatedApps`, where it exists,
 * through the manifest's entry for the app itself.
 */

import { signal, type ReadonlySignal } from "@preact/signals";

/** The parts of the non-standard `BeforeInstallPromptEvent` the app uses. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState = "installed" | "available" | "not-offered";

const promptEvent = signal<InstallPromptEvent | null>(null);
const installedNow = signal(false);

interface RelatedAppsNavigator {
  getInstalledRelatedApps?(): Promise<{ platform: string }[]>;
}

function isStandalone(): boolean {
  return ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some((mode) => globalThis.matchMedia?.(`(display-mode: ${mode})`).matches === true);
}

/** Starts listening. Called once at boot, before the event can fire. */
export function watchInstall(target: Pick<Window, "addEventListener"> = window): void {
  installedNow.value = isStandalone();
  const related = (globalThis.navigator as (Navigator & RelatedAppsNavigator) | undefined)?.getInstalledRelatedApps;
  if (!installedNow.value && typeof related === "function") {
    related.call(globalThis.navigator).then((apps) => {
      if (apps.some((app) => app.platform === "webapp")) installedNow.value = true;
    }, () => undefined);
  }
  target.addEventListener("beforeinstallprompt", (event) => {
    /* Keeps Chromium's own mini-infobar away; the offer lives in Settings. */
    event.preventDefault();
    promptEvent.value = event as InstallPromptEvent;
  });
  target.addEventListener("appinstalled", () => {
    promptEvent.value = null;
    installedNow.value = true;
  });
}

export function installState(): InstallState {
  if (installedNow.value) return "installed";
  return promptEvent.value ? "available" : "not-offered";
}

export const installSignals: { prompt: ReadonlySignal<InstallPromptEvent | null>; installed: ReadonlySignal<boolean> } = { prompt: promptEvent, installed: installedNow };

/** Shows the browser's install dialog. The event can be used once, so it is dropped whatever the answer. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = promptEvent.peek();
  if (!event) return "unavailable";
  promptEvent.value = null;
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}
