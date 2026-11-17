/**
 * What the device holds for offline use, and what the last look for a newer
 * catalog found. Shown on the Data health page; the reload prompt is the one
 * part of it that appears everywhere.
 */

import { useState } from "preact/hooks";
import { formatDateTime, formatDay, parseTime } from "../lib/format.ts";
import { checkNow, offlineStatus, reloadForNewShell } from "../offline/client.ts";
import type { DownloadFailure, UpdateResult } from "../offline/store.ts";
import { useServices } from "../services.ts";
import { Icon } from "./Icon.tsx";

const REFUSED: Record<DownloadFailure, string> = {
  unreachable: "the site was not reachable",
  missing: "a file was missing",
  mismatch: "a file did not match its checksum",
  malformed: "it is not a catalog",
  "newer-schema": "it needs a newer app",
  unverifiable: "this browser cannot verify files",
};

/** What a look for a newer catalog found, in the few words that complete "Checked …:". */
export function describeCheck(outcome: UpdateResult): string {
  switch (outcome.result) {
    case "current":
      return "up\u00a0to\u00a0date";
    case "updated":
      return "new catalog downloaded";
    case "offline":
      return "site not reachable";
    case "newer-schema":
      return "the new catalog needs a newer app";
    default:
      return `new catalog refused: ${REFUSED[outcome.reason]}`;
  }
}

/**
 * Shown on every view while the shell is too old for the catalog that is
 * published or stored, or once a file of the catalog on screen could not be
 * loaded because a newer catalog has taken its place.
 */
export function ReloadPrompt() {
  const { needsReload, leftBehind } = offlineStatus.value;
  if (!needsReload && leftBehind) {
    return (
      <div class="notice reload-prompt" role="status">
        <Icon name="warn" size={20} />
        <p>
          A newer catalog is ready.{" "}
          <button type="button" class="link-btn notice-action" onClick={() => void reloadForNewShell()}>Reload</button>
        </p>
      </div>
    );
  }
  if (!needsReload) return null;
  return (
    <div class="notice reload-prompt" role="status">
      <Icon name="warn" size={20} />
      <p>
        An update is ready.{" "}
        <button type="button" class="link-btn notice-action" onClick={() => void reloadForNewShell()}>Reload</button>
      </p>
    </div>
  );
}

export function UpdateStatus() {
  const { build } = useServices();
  const status = offlineStatus.value;
  const [checking, setChecking] = useState(false);
  const pendingBuilt = parseTime(status.pending?.generatedAt);

  const check = async (): Promise<void> => {
    setChecking(true);
    await checkNow(build.dataRoot);
    setChecking(false);
  };

  return (
    <div class="settings-block" aria-labelledby="health-offline">
      <h3 class="settings-label" id="health-offline">Offline copy</h3>
      <p class="settings-note">{!status.supported ? "Not available in this browser" : status.controlled ? "Ready" : "Ready from the next launch"}</p>
      {status.pending && (
        <p class="settings-result is-ok" role="status">
          A newer catalog{pendingBuilt !== null ? ` (${formatDay(pendingBuilt)})` : ""} shows on the next launch.
        </p>
      )}
      {status.lastCheck && (
        <p class="settings-note" role="status">Checked {formatDateTime(status.lastCheck.at)}: {describeCheck(status.lastCheck.outcome)}.</p>
      )}
      {status.supported && (
        <button type="button" class="btn" disabled={checking} onClick={() => void check()}>{checking ? "Checking…" : "Check for a newer catalog"}</button>
      )}
    </div>
  );
}
