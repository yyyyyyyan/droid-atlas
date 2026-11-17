/**
 * Measures the running app in Chromium against the budgets in
 * docs/ARCHITECTURE.md, over the DevTools protocol.
 *
 *   node scripts/measure-browser.ts <cdp-websocket-url> <app-url>
 *
 * It opens a tab of its own at 384×688, loads the app twice so the second
 * load is warm, and evaluates `scripts/browser/perf.js` in the page. The
 * numbers are desktop Chromium's; they are not a phone's. There is no CPU
 * slowdown option: the protocol's throttle did not take effect reliably in
 * headless Chromium when this was written, and a slowdown that cannot be
 * confirmed is worse than none.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [endpoint, appUrl] = process.argv.slice(2);
if (!endpoint || !appUrl) {
  console.error("usage: node scripts/measure-browser.ts <cdp-websocket-url> <app-url>");
  process.exit(2);
}
const perfScript = readFileSync(fileURLToPath(new URL("./browser/perf.js", import.meta.url)), "utf8");

interface Reply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

const socket = new WebSocket(endpoint);
const waiting = new Map<number, (reply: Reply) => void>();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const reply = JSON.parse(String(event.data)) as Reply;
  if (reply.id === undefined) return;
  waiting.get(reply.id)?.(reply);
  waiting.delete(reply.id);
});

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (reply) => (reply.error ? reject(new Error(`${method}: ${reply.error.message}`)) : resolve(reply.result ?? {})));
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(sessionId: string, expression: string): Promise<unknown> {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  return (result.result as { value?: unknown } | undefined)?.value;
}

async function load(sessionId: string, url: string): Promise<void> {
  await send("Page.navigate", { url }, sessionId);
  for (let tries = 0; tries < 200; tries += 1) {
    await pause(50);
    const ready = await evaluate(sessionId, "performance.getEntriesByName('atlas:first-view').length > 0 && document.readyState === 'complete'");
    if (ready === true) return;
  }
  throw new Error(`The app did not finish loading at ${url}`);
}

await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve());
  socket.addEventListener("error", () => reject(new Error(`Cannot connect to ${endpoint}`)));
});

const { targetId } = (await send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
try {
  await send("Page.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 384, height: 688, deviceScaleFactor: 2, mobile: true }, sessionId);
  const separator = appUrl.includes("?") ? "&" : "?";
  const [base, hash = ""] = appUrl.split("#");
  await load(sessionId, `${base}${separator}run=cold#${hash}`);
  await load(sessionId, `${base}${separator}run=warm#${hash}`);
  await pause(300);
  const report = await evaluate(sessionId, perfScript);
  console.log(JSON.stringify(JSON.parse(String(report)), null, 1));
} finally {
  await send("Target.closeTarget", { targetId });
  socket.close();
}
