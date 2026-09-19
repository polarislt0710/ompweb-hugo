// The overnight dispatch loop, as its own process.
//
// It used to live inside the web server, which is a dev server with a file
// watcher: a colleague saving a file in this repository hot-reloaded the module
// and took the loop's timer with it, and a run that was meant to carry on all
// night sat still instead. Nothing was broken and nothing was reported — it just
// stopped, which is the worst way for an unattended thing to fail.
//
// So the loop runs here, detached from the server, and claims ownership in the
// shared state file. The server stands down while this process is alive, and
// takes over again if it dies.
//
//   ompweb auto start   ompweb auto status   ompweb auto stop

import { createRequire } from "module";
import { join } from "path";

const TICK_MS = 30_000;

function loadLib(packageRoot) {
  const require = createRequire(join(packageRoot, "package.json"));
  let createJiti;
  try {
    ({ createJiti } = require("jiti"));
  } catch {
    throw new Error("The dispatch loop needs the jiti package. Run `npm install` in the ompweb directory.");
  }
  const jiti = createJiti(join(packageRoot, "scripts/auto-dispatch.mjs"), { tsconfigPaths: true });
  return jiti.import(join(packageRoot, "lib/dispatch-auto.ts"));
}

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

export async function runAutoDispatchLoop(packageRoot) {
  const { claimAutoLoop, autoTick, readAutoState } = await loadLib(packageRoot);

  const claimed = claimAutoLoop();
  if (!claimed) {
    const state = readAutoState();
    if (!state?.running) {
      console.log("Nothing to drive: no dispatch run is armed.");
      return 1;
    }
    console.log(`Another process (pid ${state.owner?.pid}) is already driving this run.`);
    return 1;
  }
  console.log(`${stamp()} driving ${claimed.cwd} — up to ${claimed.maxBatches} batches of ${claimed.batchSize}, pid ${process.pid}`);

  let stopping = false;
  const finish = () => { stopping = true; };
  process.on("SIGINT", finish);
  process.on("SIGTERM", finish);

  let lastBatches = claimed.batchesRun;
  while (!stopping) {
    try {
      await autoTick();
    } catch (error) {
      // A tick that throws must not kill the night; the next one may succeed.
      console.error(`${stamp()} tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const state = readAutoState();
    if (state && state.batchesRun !== lastBatches) {
      lastBatches = state.batchesRun;
      console.log(`${stamp()} ${state.log.at(-1)?.text ?? `batch ${state.batchesRun}`}`);
    }
    if (!state?.running) {
      console.log(`${stamp()} stopped: ${state?.stopReason ?? "unknown"} — ${state?.log.at(-1)?.text ?? ""}`);
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
  console.log(`${stamp()} asked to stop; leaving the run armed for whoever picks it up.`);
  return 0;
}
