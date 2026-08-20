import { Check, Plus } from "lucide-react";
import * as React from "react";

import {
  createCourseSearch,
  searchCourses,
  DEFAULT_SEARCH_FILTERS,
} from "@/lib/search";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/stores/catalog";
import {
  isValidCourseCode,
  useCompletedCoursesStore,
} from "@/stores/completed-courses";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { creditWeightForCode, formatCredits } from "./utils";

// cmdk chokes on rendering thousands of items, so we filter ourselves
// (shouldFilter={false}) and only ever render a small slice of the matches.
const RESULT_LIMIT = 50;

interface SearchEntry {
  code: string;
  name: string;
}

/**
 * Type-to-add course search. Selecting a row toggles the course instantly and
 * keeps focus in the input so codes can be entered back to back. Works without
 * the catalog too: a fully typed course code is always offered as a manual add.
 */
export function CompletedCoursesSearch({
  className,
}: {
  className?: string | undefined;
}) {
  const catalog = useCatalogStore((state) => state.catalog);
  const catalogStatus = useCatalogStore((state) => state.status);
  const completed = useCompletedCoursesStore((state) => state.courses);
  const toggleCourse = useCompletedCoursesStore((state) => state.toggleCourse);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query);

  const searchIndex = React.useMemo(
    () => (catalog ? createCourseSearch(catalog.courses) : null),
    [catalog],
  );

  // The catalog stores one row per offering (F/S/Y); completed courses only
  // care about the code, so collapse duplicates before slicing.
  const { matches, total } = React.useMemo(() => {
    const trimmed = deferredQuery.trim();

    if (!searchIndex || trimmed.length === 0) {
      return { matches: [] as SearchEntry[], total: 0 };
    }

    const seen = new Set<string>();
    const entries: SearchEntry[] = [];

    searchCourses(searchIndex, trimmed, DEFAULT_SEARCH_FILTERS).forEach(
      (course) => {
        if (seen.has(course.code)) {
          return;
        }

        seen.add(course.code);

        if (entries.length < RESULT_LIMIT) {
          entries.push({ code: course.code, name: course.name });
        }
      },
    );

    return { matches: entries, total: seen.size };
  }, [deferredQuery, searchIndex]);

  const manualCode = deferredQuery.trim().toUpperCase();
  const showManualEntry =
    isValidCourseCode(manualCode) &&
    !matches.some((entry) => entry.code === manualCode);
  const hasQuery = query.trim().length > 0;
  const hasResults = matches.length > 0 || showManualEntry;

  function handleToggle(code: string) {
    const wasCompleted = code in completed;

    toggleCourse(code);

    // Clearing after an add sets up the next entry; keep the query after a
    // remove so the row that was just un-checked stays visible.
    if (!wasCompleted) {
      setQuery("");
    }

    inputRef.current?.focus();
  }

  return (
    <Command
      shouldFilter={false}
      loop
      className={cn("h-auto rounded-md border bg-transparent", className)}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        placeholder="Search a course by code or name…"
        onValueChange={setQuery}
      />
      {hasQuery && (
        <CommandList className="max-h-64">
          {hasResults ? (
            <CommandGroup>
              {showManualEntry && (
                <CommandItem
                  key={`manual:${manualCode}`}
                  value={`manual:${manualCode}`}
                  onSelect={() => handleToggle(manualCode)}
                >
                  <Plus className="size-4" />
                  <span className="min-w-0 flex-1 truncate">
                    Add <span className="font-mono font-medium">{manualCode}</span>{" "}
                    manually
                  </span>
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {formatCredits(creditWeightForCode(manualCode))}
                  </Badge>
                </CommandItem>
              )}
              {matches.map((entry) => {
                const added = entry.code in completed;

                return (
                  <CommandItem
                    key={entry.code}
                    value={entry.code}
                    onSelect={() => handleToggle(entry.code)}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        added ? "text-primary opacity-100" : "opacity-20",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono font-medium">{entry.code}</span>
                      <span className="text-muted-foreground">
                        {" — "}
                        {entry.name}
                      </span>
                    </span>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {formatCredits(creditWeightForCode(entry.code))}
                    </Badge>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {searchIndex
                ? "No courses match."
                : catalogStatus === "loading"
                  ? "Loading the course catalog — you can still type a full code such as MAT137Y1."
                  : "Course search is unavailable. Type a full code such as MAT137Y1 to add it."}
            </p>
          )}
          {total > matches.length && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">
              Showing {matches.length} of {total} — keep typing to narrow.
            </div>
          )}
        </CommandList>
      )}
    </Command>
  );
}
