/**
 * Settings: how the app looks and starts, and everything about the data kept
 * on this device: what there is, whether the
 * browser has promised to keep it, and export and import.
 */

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { platformOf } from "../links.ts";
import { PRODUCT_NAME, PRODUCT_SLUG } from "../product.ts";
import { announce, prefersReducedMotion, useServices } from "../services.ts";
import { formatBytes, readPersistence, readUsage, requestPersistence, type Persistence } from "../state/persistence.ts";
import { STARTER_PINS } from "../state/pins.ts";
import type { Density, Theme } from "../state/settings.ts";
import {
  applyImport,
  buildExport,
  describeImport,
  exportFileName,
  IMPORT_FAILURE_TEXT,
  MAX_IMPORT_BYTES,
  readExport,
  serializeExport,
} from "../state/transfer.ts";
import { downloadText, readTextFile, shareableFile, shareFile } from "../ui/download.ts";
import { Icon } from "../ui/Icon.tsx";
import { InstallSection } from "../ui/Install.tsx";
import { PageHead } from "../ui/LevelHead.tsx";
import { StoreNotice } from "../ui/StoreNotice.tsx";
import { plural } from "../lib/format.ts";

/** A share this browser refused, for the rest of the page's life. */
const shareRefused = signal(false);

function Choice<T extends string>({ name, legend, value, options, onChange }: {
  name: string;
  legend: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(next: T): void;
}) {
  return (
    <fieldset class="seg">
      <legend class="settings-label">{legend}</legend>
      <div class="seg-row">
        {options.map(([option, label]) => (
          <label key={option}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Switch({ id, label, checked, onChange, children }: { id: string; label: string; checked: boolean; onChange(next: boolean): void; children?: ComponentChildren }) {
  return (
    <div class="switch-row">
      <label class="switch" for={id}>
        <span class="settings-label">{label}</span>
        <input id={id} type="checkbox" role="switch" checked={checked} aria-describedby={children ? `${id}-note` : undefined} onChange={(event) => onChange(event.currentTarget.checked)} />
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span>
      </label>
      {children && <p class="settings-note" id={`${id}-note`}>{children}</p>}
    </div>
  );
}

const THEMES: readonly (readonly [Theme, string])[] = [["system", "System"], ["dark", "Dark"], ["light", "Light"]];
const DENSITIES: readonly (readonly [Density, string])[] = [["comfortable", "Comfortable"], ["compact", "Compact"]];

const PERSISTENCE_TEXT: Record<Persistence, string> = {
  persistent: "The browser will keep this data.",
  "best-effort": "The browser may clear this when space runs short. Export to keep a copy.",
  unknown: "Export to keep a copy.",
};

/** What is kept on the device, whether the browser will keep it, and the ways to copy it out and back in. */
function DataSection() {
  const services = useServices();
  const { saved, pins, settings, build } = services;
  const [persistence, setPersistence] = useState<Persistence | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [asked, setAsked] = useState(false);
  /* A result shows under the buttons that gave it: exporting and sharing, or importing. */
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string; from: "export" | "import" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    void readPersistence().then((value) => {
      if (current) setPersistence(value);
    });
    void readUsage().then((value) => {
      if (current) setUsage(value);
    });
    return () => {
      current = false;
    };
  }, []);

  const view = saved.view.value;
  const savedCount = view.entries.length + view.missing.length;
  /* The pins the app starts with are not the person's data until they add one of their own. */
  const pinCount = pins.value.value.items.filter((pin) => !STARTER_PINS.some((starter) => starter.id === pin.id)).length;

  const say = (tone: "ok" | "problem", text: string, from: "export" | "import"): void => {
    setMessage({ tone, text, from });
    announce(text);
  };

  /* A result lands under the buttons; it is brought above the bottom bar so a tap never seems to do nothing. */
  const resultRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    resultRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion.peek() ? "auto" : "smooth" });
  }, [message]);

  const exportText = (): { name: string; text: string } => {
    const now = Date.now();
    const file = buildExport({ saved: saved.store, pins, settings }, now, { hash: build.version.hash, generatedAt: build.version.generatedAt });
    return { name: exportFileName(`${PRODUCT_SLUG}-export`, now), text: serializeExport(file) };
  };

  const download = (): void => {
    const { name, text } = exportText();
    downloadText(name, text);
    say("ok", platformOf() === "android" ? `Export saved to Downloads as ${name}.` : `Export saved as ${name}.`, "export");
  };

  /* Probed with a stand-in of the same types, and withdrawn for the session once a share has failed: a browser that refused one refuses the next. */
  const canShare = !shareRefused.value && shareableFile("probe.json", "{}") !== null;
  /* Nothing is awaited before `navigator.share`, which needs the tap that asked for it. */
  const share = async (): Promise<void> => {
    const { name, text } = exportText();
    const file = shareableFile(name, text);
    if (!file) return;
    const outcome = await shareFile(file, `${PRODUCT_NAME} export`);
    if (outcome === "failed") {
      shareRefused.value = true;
      say("problem", "Sharing failed. Use Export.", "export");
    }
  };

  const importFile = async (file: File): Promise<void> => {
    const text = await readTextFile(file, MAX_IMPORT_BYTES);
    if (text === null) {
      say("problem", `${file.size > MAX_IMPORT_BYTES ? IMPORT_FAILURE_TEXT["too-large"] : "That file cannot be read."} Nothing changed.`, "import");
      return;
    }
    const result = readExport(text);
    if (!result.ok) {
      say("problem", `${IMPORT_FAILURE_TEXT[result.reason]} Nothing changed.`, "import");
      return;
    }
    say("ok", describeImport(applyImport({ saved: saved.store, pins, settings }, result.file)), "import");
  };

  const keep = async (): Promise<void> => {
    const result = await requestPersistence();
    setPersistence(result);
    setAsked(true);
    announce(result === "persistent" ? "The browser will keep this data" : "The browser declined for now");
  };

  return (
    <section aria-labelledby="settings-data">
      <h2 class="overline" id="settings-data">Your data</h2>
      <p class="settings-lead">
        {plural(savedCount, "saved app")}{view.notes.size > 0 ? ` (${view.notes.size} with a note)` : ""}
        {pinCount > 0 ? ` and ${plural(pinCount, "pinned query", "pinned queries")}` : ""}, on this device only.
        {usage !== null && usage > 0 && ` ${formatBytes(usage)} stored.`}
      </p>
      <StoreNotice store={saved.store} what="saved apps" fresh="an empty list" />
      <StoreNotice store={pins} what="pinned queries" fresh="the starter pins" />
      <StoreNotice store={settings} what="settings" fresh="the defaults" />

      <div class="settings-block">
        <p class="settings-note" role="status">{persistence === null ? "Asking the browser…" : PERSISTENCE_TEXT[persistence]}</p>
        {persistence === "best-effort" && (
          <>
            <button type="button" class="btn" onClick={() => void keep()}>Ask the browser to keep it</button>
            {asked && (
              <p class="settings-note">The browser declined. Installing the app usually changes that.</p>
            )}
          </>
        )}
      </div>

      <div class="settings-block">
        <div class="settings-actions">
          <button type="button" class="btn" onClick={download}><Icon name="store" size={18} />Export</button>
          {canShare && <button type="button" class="btn" onClick={() => void share()}><Icon name="share" size={18} />Share</button>}
        </div>
        {message?.from === "export" && <p ref={resultRef} class={`settings-result is-${message.tone}`} role="status">{message.text}</p>}
      </div>

      <div class="settings-block">
        <p class="settings-note">Importing merges with what is here.</p>
        <div class="settings-actions">
          <button type="button" class="btn" onClick={() => fileRef.current?.click()}><Icon name="import" size={18} />Import</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,text/plain,.txt"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
        {message?.from === "import" && <p ref={resultRef} class={`settings-result is-${message.tone}`} role="status">{message.text}</p>}
      </div>
    </section>
  );
}

export function SettingsView() {
  const { settings } = useServices();
  const current = settings.value.value;
  return (
    <div class="view view-page">
      <PageHead title="Settings" />
      <div class="settings">
        <section aria-labelledby="settings-look">
          <h2 class="overline" id="settings-look">Appearance</h2>
          <Choice name="theme" legend="Theme" value={current.theme} options={THEMES} onChange={(theme) => settings.update((value) => ({ ...value, theme }))} />
          <Choice name="density" legend="Rows" value={current.density} options={DENSITIES} onChange={(density) => settings.update((value) => ({ ...value, density }))} />
        </section>

        <section aria-label="Starting">
          <Switch id="setting-resume" label="Resume where I left off" checked={current.resume} onChange={(resume) => settings.update((value) => ({ ...value, resume }))} />
        </section>

        <DataSection />
        <InstallSection />

      </div>
    </div>
  );
}
