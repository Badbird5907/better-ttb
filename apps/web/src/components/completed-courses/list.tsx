import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import {
  useCompletedCoursesStore,
  type CompletedCourseGrade,
} from "@/stores/completed-courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  creditWeightForCode,
  formatCredits,
  subjectPrefix,
  totalCredits,
  useCourseNamesByCode,
} from "./utils";

interface SubjectGroup {
  subject: string;
  codes: string[];
  credits: number;
}

/** Completed courses grouped by subject prefix, newest state straight from the store. */
export function CompletedCoursesList({
  className,
}: {
  className?: string | undefined;
}) {
  const courses = useCompletedCoursesStore((state) => state.courses);
  const namesByCode = useCourseNamesByCode();

  const groups = React.useMemo(
    () => groupBySubject(Object.keys(courses)),
    [courses],
  );

  if (groups.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed px-3 py-8 text-center",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No courses yet — search above, or paste your transcript to add them all
          at once.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "max-h-80 overflow-y-auto rounded-md border",
        className,
      )}
    >
      {groups.map((group) => (
        <div key={group.subject}>
          <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 border-b bg-muted/70 px-3 py-1 backdrop-blur-sm">
            <span className="font-mono text-xs font-semibold">
              {group.subject}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {group.codes.length} · {formatCredits(group.credits)} FCE
            </span>
          </div>
          {group.codes.map((code) => (
            <CompletedCourseRow
              key={code}
              code={code}
              grade={courses[code] ?? null}
              name={namesByCode.get(code) ?? null}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CompletedCourseRow({
  code,
  grade,
  name,
}: {
  code: string;
  grade: CompletedCourseGrade;
  name: string | null;
}) {
  const setCourse = useCompletedCoursesStore((state) => state.setCourse);
  const removeCourse = useCompletedCoursesStore((state) => state.removeCourse);

  function handleGradeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value.trim();

    setCourse(code, value === "" ? null : Number(value));
  }

  return (
    <div className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
      <span className="w-[5.5rem] shrink-0 font-mono text-sm font-medium">
        {code}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {name ?? <span className="italic opacity-70">Not in loaded catalog</span>}
      </span>
      <Badge variant="outline" className="shrink-0 tabular-nums">
        {formatCredits(creditWeightForCode(code))}
      </Badge>
      <Input
        type="number"
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        value={grade === null ? "" : String(grade)}
        placeholder="%"
        aria-label={`Grade for ${code}`}
        className="h-7 w-14 shrink-0 px-2 text-xs tabular-nums md:text-xs"
        onChange={handleGradeChange}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => removeCourse(code)}
      >
        <X />
        <span className="sr-only">Remove {code}</span>
      </Button>
    </div>
  );
}

function groupBySubject(codes: readonly string[]): SubjectGroup[] {
  const bySubject = new Map<string, string[]>();

  codes.forEach((code) => {
    const subject = subjectPrefix(code);
    const group = bySubject.get(subject);

    if (group) {
      group.push(code);
    } else {
      bySubject.set(subject, [code]);
    }
  });

  return [...bySubject.entries()]
    .map(([subject, group]) => {
      const sorted = [...group].sort((left, right) => left.localeCompare(right));

      return { subject, codes: sorted, credits: totalCredits(sorted) };
    })
    .sort((left, right) => left.subject.localeCompare(right.subject));
}
