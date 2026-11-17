/**
 * The install section of Settings: a button where the browser offers
 * installation. Where it does not, Android's browsers still install from
 * their menu, which is said. Running installed, installed already, or
 * anywhere else, the section is left out.
 */

import { PRODUCT_NAME } from "../product.ts";
import { announce, useServices } from "../services.ts";
import { installState, promptInstall } from "../state/install.ts";
import { Icon } from "./Icon.tsx";

export function InstallSection() {
  const { platform } = useServices();
  const state = installState();
  if (state === "installed" || (state === "not-offered" && platform !== "android")) return null;
  const install = async (): Promise<void> => {
    const outcome = await promptInstall();
    if (outcome === "accepted") announce(`${PRODUCT_NAME} is being installed`);
  };

  return (
    <section aria-labelledby="settings-install">
      <h2 class="overline" id="settings-install">Install</h2>
      {state === "available" && (
        <button type="button" class="btn settings-install" onClick={() => void install()}><Icon name="store" size={18} />Install {PRODUCT_NAME}</button>
      )}
      {state === "not-offered" && (
        <p class="settings-note">
          In the browser menu, choose Add to Home screen.
        </p>
      )}
    </section>
  );
}
