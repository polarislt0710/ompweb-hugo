// `ompweb capture` — screenshots from a shell, for the agents that execute a plan.
//
// The connector gives ChatGPT capture_page. An omp worker has only bash, so a
// plan that says "capture these three pages" had no way to be carried out. This
// is that tool: same browser, same saved signed-in session, same viewports, and
// a JSON manifest a visual-checker can read alongside the PNGs.
//
// It writes files and prints a manifest. It never starts a server, submits a
// form, or logs anybody in.

import { mkdirSync, writeFileSync } from "fs";
import { basename, isAbsolute, join, resolve } from "path";
import { existsSync } from "fs";
import { createRequire } from "module";

const USAGE = `ompweb capture <target...> [options]

Targets   a page address (https://example.com/dashboard, example.com/pricing)
          or an .html file in the current project.

Options
  --out DIR         where the PNGs and manifest go (default ./captures)
  --viewport WHICH  desktop | phone | both          (default both)
  --width N         custom viewport width, overrides --viewport
  --height N        custom viewport height
  --no-full-page    just the first screen, not the whole page
  --wait MS         extra settle time per page, up to 30000 (default 1200)
  --json            print only the manifest JSON

A host you saved a signed-in session for in OMP Web is captured signed in, and
every shot records where the browser actually landed — so a silent redirect to a
login page shows up instead of passing as the real screen.`;

function parseArgs(argv) {
  const options = { targets: [], out: "captures", viewport: "both", fullPage: true, waitMs: 1200, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[++index];
    if (argument === "--help" || argument === "-h") return { help: true };
    else if (argument === "--out") options.out = next();
    else if (argument === "--viewport") options.viewport = next();
    else if (argument === "--width") options.width = Number(next());
    else if (argument === "--height") options.height = Number(next());
    else if (argument === "--no-full-page") options.fullPage = false;
    else if (argument === "--full-page") options.fullPage = true;
    else if (argument === "--wait") options.waitMs = Number(next());
    else if (argument === "--json") options.json = true;
    else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}. Run with --help.`);
    else options.targets.push(argument);
  }
  return options;
}

/** The capture code is TypeScript in this package; jiti is how a script loads it. */
async function loadCapture(packageRoot) {
  const require = createRequire(join(packageRoot, "package.json"));
  let createJiti;
  try {
    ({ createJiti } = require("jiti"));
  } catch {
    throw new Error("`ompweb capture` needs the jiti package, which is part of this checkout's dependencies. Run `npm install` in the ompweb directory.");
  }
  const jiti = createJiti(join(packageRoot, "scripts/capture-cli.mjs"), { tsconfigPaths: true });
  return jiti.import(join(packageRoot, "lib/mcp/screenshots.ts"));
}

/** A safe-ish file name for one shot, kept recognisable. */
function fileNameFor(target, viewport, index) {
  const slug = target
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "page";
  return `${String(index + 1).padStart(2, "0")}-${slug}-${viewport}.png`;
}

export async function runCaptureCli(argv, packageRoot) {
  const options = parseArgs(argv);
  if (options.help || options.targets.length === 0) {
    console.log(USAGE);
    return options.help ? 0 : 1;
  }

  const { capturePages } = await loadCapture(packageRoot);
  const cwd = process.cwd();
  const project = { name: basename(cwd), path: cwd, git: existsSync(join(cwd, ".git")) };
  const outDir = isAbsolute(options.out) ? options.out : resolve(cwd, options.out);
  mkdirSync(outDir, { recursive: true });

  const started = Date.now();
  const result = await capturePages(project, options.targets, {
    viewport: options.viewport,
    width: Number.isFinite(options.width) ? options.width : undefined,
    height: Number.isFinite(options.height) ? options.height : undefined,
    fullPage: options.fullPage,
    waitMs: options.waitMs,
  });

  // capturePages returns one image per target × viewport, target-major.
  const perTarget = options.viewport === "both" && !Number.isFinite(options.width) ? 2 : 1;
  const shots = result.images.map((image, index) => {
    // "https://x/y (desktop 1280px, signed in) — redirected to …"
    const described = /\(([^)]*)\)/.exec(image.source)?.[1] ?? "";
    const viewport = described.split(" ")[0] || "shot";
    const target = options.targets[Math.floor(index / perTarget)] ?? "page";
    const file = join(outDir, fileNameFor(target, viewport, index));
    writeFileSync(file, Buffer.from(image.data, "base64"));
    return {
      file,
      describes: image.source,
      viewport,
      signed_in: described.includes("signed in"),
      redirected_to: image.redirectedTo ?? null,
      http_status: image.status ?? 200,
      bytes: image.bytes,
    };
  });

  const manifest = {
    captured_at: new Date().toISOString(),
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    project: project.path,
    requested: options.targets,
    viewport: options.viewport,
    full_page: options.fullPage,
    shots,
    not_captured: result.notes,
  };
  const manifestPath = join(outDir, "captures.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    for (const shot of shots) {
      console.log(`${shot.file}  ${shot.describes}`);
    }
    for (const note of result.notes) console.log(`not captured: ${note}`);
    console.log(`manifest: ${manifestPath}`);
  }
  // A page that redirected somewhere else is not the page that was asked for.
  // A redirect, a 404 or a 403 means the page asked for is not the page captured.
  return shots.some((shot) => shot.redirected_to || shot.http_status >= 400) || result.notes.length > 0 ? 2 : 0;
}
