import { GraduationCap, Trash2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import {
  isValidCourseCode,
  useCompletedCoursesStore,
} from "@/stores/completed-courses";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function CompletedCoursesButton() {
  const codeInputId = React.useId();
  const gradeInputId = React.useId();
  const [code, setCode] = React.useState("");
  const [grade, setGrade] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const courses = useCompletedCoursesStore((state) => state.courses);
  const setCourse = useCompletedCoursesStore((state) => state.setCourse);
  const removeCourse = useCompletedCoursesStore((state) => state.removeCourse);
  const clearAll = useCompletedCoursesStore((state) => state.clearAll);

  const entries = React.useMemo(
    () =>
      Object.entries(courses).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [courses],
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedCode = code.trim().toUpperCase();

    if (!isValidCourseCode(normalizedCode)) {
      setError("Invalid course code");
      return;
    }

    const parsedGrade = grade.trim() === "" ? null : Number(grade);

    setCourse(normalizedCode, parsedGrade);
    setCode("");
    setGrade("");
    setError(null);
  }

  function handleCodeChange(event: React.ChangeEvent<HTMLInputElement>) {
    setCode(event.target.value);
    setError(null);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm">
          <GraduationCap />
          <span className="sr-only">My courses</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>My completed courses</DialogTitle>
          <DialogDescription>
            These courses are highlighted green in prerequisite views. Grade is
            optional and is only used for prerequisites requiring a minimum %.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-2" onSubmit={handleSubmit}>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <div>
              <label className="sr-only" htmlFor={codeInputId}>
                Course code
              </label>
              <Input
                id={codeInputId}
                value={code}
                placeholder="e.g. MAT137Y1"
                aria-invalid={error ? true : undefined}
                onChange={handleCodeChange}
              />
            </div>
            <div>
              <label className="sr-only" htmlFor={gradeInputId}>
                Grade %
              </label>
              <Input
                id={gradeInputId}
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={grade}
                placeholder="Grade %"
                onChange={(event) => setGrade(event.target.value)}
              />
            </div>
            <Button type="submit">Add</Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>

        <div className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No courses added yet.</p>
          ) : (
            <>
              <div className="max-h-72 overflow-y-auto rounded-md border">
                {entries.map(([courseCode, courseGrade]) => (
                  <div
                    key={courseCode}
                    className="flex items-center gap-3 border-t px-3 py-2 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1 font-mono text-sm font-medium">
                      {courseCode}
                    </span>
                    <span className="w-12 text-right text-sm text-muted-foreground">
                      {courseGrade === null ? "—" : `${courseGrade}%`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeCourse(courseCode)}
                    >
                      <Trash2 />
                      <span className="sr-only">Remove {courseCode}</span>
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "text-destructive hover:text-destructive",
                    "dark:hover:text-destructive",
                  )}
                  onClick={clearAll}
                >
                  Clear all
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
