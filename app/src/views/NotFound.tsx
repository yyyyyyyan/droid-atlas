import { EXPLORE } from "../router/route.ts";
import { Icon } from "../ui/Icon.tsx";
import { RouteLink } from "../ui/Link.tsx";

/**
 * @param message what was not found, when there is more to say than that
 * @param search a word worth searching for instead, when the address named an entry that is not there
 */
export function NotFound({ message = null, search = null }: { message?: string | null; search?: string | null }) {
  return (
    <div class="view">
      <div class="status">
        <div class="status-inner">
          <h1 class="status-title">Not found</h1>
          {message && <p class="status-text" dir="auto">{message}</p>}
          <div class="status-actions">
            {search && (
              <RouteLink route={{ path: ["search"], params: { q: search } }} class="btn btn-strong">
                <Icon name="search" size={18} />Search for “{search}”
              </RouteLink>
            )}
            <RouteLink route={EXPLORE} class="btn"><Icon name="explore" size={18} />Back to the map</RouteLink>
          </div>
        </div>
      </div>
    </div>
  );
}
