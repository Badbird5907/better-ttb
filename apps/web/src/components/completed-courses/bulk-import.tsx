import { Check, ChevronDown, ClipboardPaste } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useCompletedCoursesStore } from "@/stores/completed-courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { extractCourseCodes } from "./utils";

// Long transcripts can yield hundreds of codes; only preview a readable slice.
const PREVIEW_LIMIT = 60;

/**
 * Paste-anything importer: scrapes course codes out of transcript text (or any
 * comma/newline separated list), previews them as chips split into new vs
 * already added, and adds them all in one click.
 */
export function CompletedCoursesBulkImport({
  className,
}: {
  className?: string | undefined;
}) {
  const textareaId = React.useId();
  const completed = useCompletedCoursesStore((state) => state.courses);
  const addMany = useCompletedCoursesStore((state) => state.addMany);

  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [addedCount, setAddedCount] = React.useState<number | null>(null);
  const deferredText = React.useDeferredValue(text);

  const codes = React.useMemo(
    () => extractCourseCodes(deferredText),
    [deferredText],
  );
  const newCodes = React.useMemo(
    () => codes.filter((code) => !(code in completed)),
    [codes, completed],
  );
  const duplicateCount = codes.length - newCodes.length;

  function handleToggleOpen() {
    setOpen((previous) => !previous);
    setAddedCount(null);
  }

  function handleAddAll() {
    addMany(newCodes);
    setAddedCount(newCodes.length);
    setText("");
    setOpen(false);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={textareaId}
          onClick={handleToggleOpen}
        >
          <ClipboardPaste />
          Paste transcript or a list of codes
          <ChevronDown
            className={cn("transition-transform", open && "rotate-180")}
          />
        </Button>
        {addedCount !== null && !open && (
          <span className="text-xs text-muted-foreground">
            {addedCount === 0
              ? "Nothing new to add."
              : `Added ${addedCount} ${addedCount === 1 ? "course" : "courses"}.`}
          </span>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-md border p-3">
          <textarea
            id={textareaId}
            value={text}
            rows={4}
            autoFocus
            spellCheck={false}
            placeholder={
              "Paste anything — transcript text, or codes like\nCSC148H1, MAT137Y1, STA130H1"
            }
            className={cn(
              "w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none transition-[color,box-shadow]",
              "placeholder:font-sans placeholder:text-muted-foreground dark:bg-input/30",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            )}
            onChange={(event) => setText(event.target.value)}
          />

          {codes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {text.trim().length === 0
                ? "Codes are detected automatically as you paste."
                : "No course codes found in that text."}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Found {codes.length} {codes.length === 1 ? "code" : "codes"} ·{" "}
                <span className="font-medium text-foreground">
                  {newCodes.length} new
                </span>
                {duplicateCount > 0 && ` · ${duplicateCount} already added`}
              </p>
              <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                {codes.slice(0, PREVIEW_LIMIT).map((code) => {
                  const alreadyAdded = code in completed;

                  return (
                    <Badge
                      key={code}
                      variant={alreadyAdded ? "outline" : "secondary"}
                      className={cn(
                        "font-mono",
                        alreadyAdded && "text-muted-foreground",
                      )}
                    >
                      {alreadyAdded && <Check />}
                      {code}
                    </Badge>
                  );
                })}
                {codes.length > PREVIEW_LIMIT && (
                  <Badge variant="ghost" className="text-muted-foreground">
                    +{codes.length - PREVIEW_LIMIT} more
                  </Badge>
                )}
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={text.length === 0}
              onClick={() => setText("")}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={newCodes.length === 0}
              onClick={handleAddAll}
            >
              Add {newCodes.length > 0 ? newCodes.length : ""}{" "}
              {newCodes.length === 1 ? "course" : "courses"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
