import type { DegreeProgram } from "@better-ttb/shared";
import { Check, Plus, Search } from "lucide-react";
import * as React from "react";

import {
  countProgramsByType,
  filterPrograms,
  PROGRAM_TYPES,
  type ProgramSearchEntry,
  type ProgramTypeFilter,
} from "@/lib/degree/filter";
import type { ProgramCatalogStatus } from "@/lib/degree/use-programs";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCredits,
  PROGRAM_TYPE_LABELS,
  ProgramTypeBadge,
} from "./program-meta";

/** Rendering more than this many rows makes typing feel laggy. */
const RESULT_LIMIT = 50;

const TYPE_FILTERS: readonly ProgramTypeFilter[] = ["all", ...PROGRAM_TYPES];

/**
 * Search over all 411 calendar programs. Filtering is done by hand (rather than
 * with cmdk) so the result list can be capped and scored — see
 * `@/lib/degree/filter`.
 */
export function ProgramPicker({
  index,
  status,
  selectedIds,
  onAdd,
  autoFocus = false,
  listClassName,
  className,
}: {
  index: readonly ProgramSearchEntry[] | null;
  status: ProgramCatalogStatus;
  selectedIds: readonly string[];
  onAdd: (programId: string) => void;
  autoFocus?: boolean | undefined;
  listClassName?: string | undefined;
  className?: string | undefined;
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState<ProgramTypeFilter>("all");

  // Typing stays responsive even while the 411-program scan re-runs.
  const deferredQuery = React.useDeferredValue(query);

  const counts = React.useMemo(
    () =>
      index === null
        ? null
        : countProgramsByType(index, deferredQuery),
    [index, deferredQuery],
  );

  const { matches, total } = React.useMemo(
    () =>
      index === null
        ? { matches: [] as DegreeProgram[], total: 0 }
        : filterPrograms(index, deferredQuery, type, RESULT_LIMIT),
    [index, deferredQuery, type],
  );

  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search programs — try “cs major”"
          className="h-9 pl-8"
          disabled={status !== "ready"}
          autoFocus={autoFocus}
          aria-label="Search degree programs"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {TYPE_FILTERS.map((value) => {
          const active = value === type;
          const count = counts?.[value] ?? 0;

          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              disabled={status !== "ready"}
              onClick={() => setType(value)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-ring hover:text-foreground",
                counts !== null && count === 0 && !active && "opacity-40",
              )}
            >
              {value === "all" ? "All" : PROGRAM_TYPE_LABELS[value]}
              {counts !== null && (
                <span className="ml-1 tabular-nums opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "min-h-0 overflow-y-auto rounded-md border",
          listClassName ?? "max-h-72",
        )}
      >
        {status === "loading" && (
          <div className="space-y-2 p-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}

        {status === "error" && (
          <p className="p-3 text-xs text-muted-foreground">
            The program catalogue failed to load. Reload the page to try again.
          </p>
        )}

        {status === "ready" && matches.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            No programs match “{query}”.
          </p>
        )}

        {matches.map((program) => (
          <ProgramRow
            key={program.id}
            program={program}
            added={selected.has(program.id)}
            onAdd={() => onAdd(program.id)}
          />
        ))}
      </div>

      {status === "ready" && total > matches.length && (
        <p className="text-[11px] text-muted-foreground">
          Showing {matches.length} of {total} — keep typing to narrow.
        </p>
      )}
    </div>
  );
}

function ProgramRow({
  program,
  added,
  onAdd,
}: {
  program: DegreeProgram;
  added: boolean;
  onAdd: () => void;
}): React.ReactElement {
  const totalCredits = program.completion?.totalCredits ?? null;

  return (
    <div className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0 hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="truncate text-xs font-medium">{program.name}</span>
          <ProgramTypeBadge type={program.type} />
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
          {program.degree !== null && (
            <span className="capitalize">{program.degree}</span>
          )}
          {totalCredits !== null && (
            <span className="tabular-nums">
              {formatCredits(totalCredits)} cr
            </span>
          )}
          {program.sections.length > 0 && (
            <span className="truncate">{program.sections.join(" · ")}</span>
          )}
        </div>
      </div>

      {/* Deliberately not `disabled`: disabling the focused button inside the
          picker popover would drop focus and dismiss it mid-search. */}
      <button
        type="button"
        aria-disabled={added}
        onClick={() => {
          if (!added) {
            onAdd();
          }
        }}
        aria-label={added ? `${program.name} added` : `Add ${program.name}`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
          added
            ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300"
            : "border-border text-muted-foreground hover:border-ring hover:text-foreground",
        )}
      >
        {added ? <Check className="size-3" /> : <Plus className="size-3" />}
        {added ? "Added" : "Add"}
      </button>
    </div>
  );
}
