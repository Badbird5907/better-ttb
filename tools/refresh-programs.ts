/**
 * Refreshes `apps/web/public/programs.json` from the U of T Arts & Science
 * calendar's Drupal JSON:API.
 *
 * Run with: `pnpm programs:refresh`
 *
 * The endpoint is publicly enabled and permitted by robots.txt. It is not rate
 * limited, but we still pace requests and send a descriptive User-Agent.
 *
 * Flags:
 *   --out <path>    write somewhere other than apps/web/public/programs.json
 *   --cache <path>  reuse (or populate) a raw JSON:API dump instead of fetching
 *   --quiet         suppress the per-page progress log
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  completionIsFullyTyped,
  inferProgramType,
  parseCompletionRequirements,
  parseProgramCode,
  parseProgramTitle,
  type DegreeProgram,
  type ProgramCatalog,
  type ProgramType,
} from "../packages/shared/src/programs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = resolve(ROOT, "apps/web/public/programs.json");

const ORIGIN = "https://artsci.calendar.utoronto.ca";
const SOURCE = `${ORIGIN}/jsonapi/node/programs`;
const PAGE_LIMIT = 50; // The API silently caps `page[limit]` at 50.
const MAX_PAGES = 50; // ~411 programs today; a runaway `links.next` loop backstop.
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = [500, 2_000, 8_000] as const;
const USER_AGENT =
  "better-ttb-degree-planner/1.0 (U of T timetable tool; +https://github.com/Badbird5907/better-ttb)";

// ---------------------------------------------------------------------------
// JSON:API shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface TextField {
  value: string;
  processed?: string;
  format?: string;
}

interface ProgramAttributes {
  title?: string;
  changed?: string;
  field_post_code?: string | null;
  field_section?: string[] | null;
  path?: { alias?: string | null } | null;
  field_completion_requirements?: TextField | null;
  field_enrolment_requirements?: TextField | null;
}

interface ProgramResource {
  id: string;
  attributes?: ProgramAttributes;
}

interface JsonApiPage {
  data?: ProgramResource[];
  links?: { next?: { href?: string } };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function fetchAllPrograms(log: (message: string) => void): Promise<
  ProgramResource[]
> {
  const resources: ProgramResource[] = [];
  let url: string | null = `${SOURCE}?page%5Blimit%5D=${PAGE_LIMIT}`;
  let page = 0;

  while (url !== null) {
    page += 1;
    if (page > MAX_PAGES) {
      throw new Error(
        `Pagination exceeded ${MAX_PAGES} pages — refusing to follow further ` +
          `\`links.next\` chains (last URL: ${url})`,
      );
    }

    const response = await fetchWithRetry(url, log);
    const body = (await response.json()) as JsonApiPage;
    const data = body.data ?? [];
    resources.push(...data);
    log(`  page ${page}: +${data.length} (${resources.length} total)`);

    url = nextPageUrl(body.links?.next?.href);
    if (url !== null) await sleep(REQUEST_DELAY_MS);
  }

  return resources;
}

/**
 * `links.next` comes from the response body, so treat it as untrusted: resolve
 * it against the calendar origin and refuse to follow cross-origin links.
 * (Node's fetch also rejects relative URLs outright.)
 */
function nextPageUrl(next: unknown): string | null {
  if (typeof next !== "string" || next.length === 0) return null;

  let resolved: URL;
  try {
    resolved = new URL(next, ORIGIN);
  } catch {
    throw new Error(`Refusing to follow malformed \`links.next\`: ${next}`);
  }

  if (resolved.origin !== ORIGIN) {
    throw new Error(`Refusing to follow cross-origin \`links.next\`: ${next}`);
  }

  return resolved.href;
}

/** Transient failures (network, 429, 5xx) retry with bounded backoff. */
async function fetchWithRetry(
  url: string,
  log: (message: string) => void,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response | null = null;
    let networkError: unknown = null;

    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.api+json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      networkError = error;
    }

    if (response !== null && response.ok) return response;

    const retryable =
      networkError !== null ||
      (response !== null &&
        (response.status === 429 || response.status >= 500));
    const backoff = RETRY_BACKOFF_MS[attempt];

    if (!retryable || backoff === undefined) {
      if (response !== null) {
        throw new Error(
          `GET ${url} failed: ${response.status} ${response.statusText}`,
        );
      }
      throw new Error(`GET ${url} failed: ${String(networkError)}`);
    }

    log(
      `  retrying ${url} in ${backoff}ms (${
        response !== null ? `HTTP ${response.status}` : String(networkError)
      })`,
    );
    await sleep(backoff);
  }
}

// ---------------------------------------------------------------------------
// Transformation
// ---------------------------------------------------------------------------

function slugFromAlias(alias: string | null | undefined): string | null {
  if (typeof alias !== "string") return null;
  const tail = alias.split("/").filter((part) => part.length > 0).pop();
  return tail !== undefined && tail.length > 0 ? tail.toLowerCase() : null;
}

/** Turns a slug back into words so `inferProgramType` can read it. */
function slugWords(slug: string): string {
  return slug.split("-").join(" ");
}

function toProgram(resource: ProgramResource): DegreeProgram | null {
  const attributes = resource.attributes ?? {};
  const title = (attributes.title ?? "").trim();
  if (title.length === 0) return null;

  const slug = slugFromAlias(attributes.path?.alias);
  if (slug === null) {
    // Records without a path alias (the combined-degree bundle) are skipped.
    return null;
  }

  const parsedCode = parseProgramCode(attributes.field_post_code);
  const code = parsedCode?.code ?? null;
  const id = code ?? slug;

  const type: ProgramType =
    parsedCode?.type ??
    inferProgramType(title) ??
    inferProgramType(slugWords(slug)) ??
    "certificate";

  const { name, degree } = parseProgramTitle(title);

  const completionHtml = attributes.field_completion_requirements?.value ?? null;
  const completion =
    typeof completionHtml === "string" && completionHtml.trim().length > 0
      ? parseCompletionRequirements(completionHtml)
      : null;

  const courseCodes: string[] = [];
  if (completion !== null) {
    const seen = new Set<string>();
    for (const section of completion.sections) {
      for (const clause of section.clauses) {
        for (const course of clause.courses) {
          if (!seen.has(course)) {
            seen.add(course);
            courseCodes.push(course);
          }
        }
      }
    }
    courseCodes.sort();
  }

  return {
    id,
    code,
    slug,
    title,
    name,
    degree,
    type,
    sections: attributes.field_section ?? [],
    changed: attributes.changed ?? "",
    url: `${ORIGIN}/program/${slug}`,
    enrolmentRawHtml: attributes.field_enrolment_requirements?.value ?? null,
    completion,
    courseCodes,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(programs: DegreeProgram[], bytes: number): void {
  const byType = new Map<string, number>();
  const byConfidence = new Map<string, number>();
  let withCompletion = 0;
  let withTotalCredits = 0;
  let clauseCount = 0;
  let advisoryCount = 0;
  let parsedClauses = 0;
  let fullyTyped = 0;

  for (const program of programs) {
    byType.set(program.type, (byType.get(program.type) ?? 0) + 1);

    const completion = program.completion;
    if (completion === null) {
      byConfidence.set("missing", (byConfidence.get("missing") ?? 0) + 1);
      continue;
    }

    withCompletion += 1;
    byConfidence.set(
      completion.confidence,
      (byConfidence.get(completion.confidence) ?? 0) + 1,
    );
    if (completion.totalCredits !== null) withTotalCredits += 1;
    if (completionIsFullyTyped(completion)) fullyTyped += 1;

    for (const section of completion.sections) {
      for (const clause of section.clauses) {
        clauseCount += 1;
        if (clause.advisory) {
          advisoryCount += 1;
        } else if (clause.req !== null && clause.req.kind !== "text") {
          parsedClauses += 1;
        }
      }
    }
  }

  const requirementClauses = clauseCount - advisoryCount;
  const pct = (part: number, whole: number): string =>
    whole === 0 ? "0%" : `${((part / whole) * 100).toFixed(1)}%`;

  console.log("");
  console.log(`programs:              ${programs.length}`);
  console.log(
    `  by type:             ${[...byType]
      .sort()
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}`,
  );
  console.log(`  with completion:     ${withCompletion}`);
  console.log(
    `  confidence:          ${[...byConfidence]
      .sort()
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}`,
  );
  console.log(
    `  total credits known: ${withTotalCredits} (${pct(withTotalCredits, withCompletion)} of parsed)`,
  );
  console.log(
    `  no residual prose:   ${fullyTyped} (${pct(fullyTyped, withCompletion)} of parsed)`,
  );
  console.log(
    `clauses:               ${clauseCount} (${requirementClauses} requirement, ${advisoryCount} advisory)`,
  );
  console.log(
    `  structured reqs:     ${parsedClauses} (${pct(parsedClauses, requirementClauses)} of requirement clauses)`,
  );
  console.log(`file size:             ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const quiet = process.argv.includes("--quiet");
  const log = (message: string): void => {
    if (!quiet) console.log(message);
  };

  const outPath = resolve(readFlag("out") ?? DEFAULT_OUT);
  const cachePath = readFlag("cache");

  let resources: ProgramResource[] | null = null;

  if (cachePath !== null) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(resolve(cachePath), "utf8"),
      );
      // A cache file holding anything but an array falls back to fetching.
      resources = Array.isArray(parsed) ? (parsed as ProgramResource[]) : null;
      if (resources !== null) {
        log(`using cached JSON:API dump (${resources.length} records)`);
      }
    } catch {
      resources = null;
    }
  }

  if (resources === null) {
    log(`fetching ${SOURCE}`);
    resources = await fetchAllPrograms(log);
    if (cachePath !== null) {
      await writeFile(resolve(cachePath), JSON.stringify(resources), "utf8");
    }
  }

  const programs: DegreeProgram[] = [];
  const seen = new Set<string>();

  for (const resource of resources) {
    const program = toProgram(resource);
    if (program === null) continue;
    if (seen.has(program.id)) {
      console.warn(`  duplicate program id, skipping: ${program.id}`);
      continue;
    }
    seen.add(program.id);
    programs.push(program);
  }

  // Sorted by id so regenerated files produce reviewable diffs.
  programs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const catalog: ProgramCatalog = {
    version: 1,
    scrapedAt: new Date().toISOString(),
    source: SOURCE,
    programs,
  };

  // One compact line per program: keeps the file small enough to ship in the
  // web bundle while still producing per-program diffs on regeneration.
  const header = JSON.stringify({ ...catalog, programs: [] }).replace(
    /,"programs":\[\]\}$/,
    ',"programs":[\n',
  );
  const json = `${header}${programs
    .map((program) => JSON.stringify(program))
    .join(",\n")}\n]}\n`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json, "utf8");

  log(`wrote ${outPath}`);
  report(programs, Buffer.byteLength(json, "utf8"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
