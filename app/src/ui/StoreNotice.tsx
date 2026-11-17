/**
 * Says so when something kept on the device is not in its normal state: the
 * browser is not keeping data, the stored value was unreadable and has been
 * set aside, or it was written by a newer version of the app and is being
 * left alone. Renders nothing while the store is fine.
 */

import type { Store } from "../state/storage.ts";
import { Icon } from "./Icon.tsx";
import { Tip } from "./Tip.tsx";

interface Props {
  store: Pick<Store<unknown>, "status" | "acknowledge">;
  /** Plural noun phrase for what the store holds: "saved apps", "pinned queries", "settings". */
  what: string;
  /** What the store holds after a reset: "an empty list", "the starter pins", "the defaults". */
  fresh: string;
}

export function StoreNotice({ store, what, fresh }: Props) {
  const status = store.status.value;
  if (status === "ok") return null;
  const subject = what.charAt(0).toUpperCase() + what.slice(1);
  return (
    <div class="notice" role="status">
      <Icon name="warn" size={20} />
      {status === "unavailable" && (
        <p>This browser is not keeping data for this site: {what} last until the page is closed.</p>
      )}
      {status === "recovered" && (
        <>
          <p>{subject} on this device could not be read, and start again from {fresh}.</p>
          <button type="button" class="icon-btn" aria-label="Dismiss" onClick={() => store.acknowledge()}><Icon name="close" size={18} /><Tip text="Dismiss" at="end" /></button>
        </>
      )}
      {status === "newer" && (
        <p>
          {subject} on this device are from a newer version of the app. Changes made here are not kept.{" "}
          <button type="button" class="link-btn notice-action" onClick={() => window.location.reload()}>Reload</button>
        </p>
      )}
    </div>
  );
}
