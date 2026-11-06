/**
 * Runs once when the Next.js server starts and sets up the AI Trader background loop
 * (see instrumentation-node.ts). Uses Next's documented pattern so the Node-only code
 * is never bundled for the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
