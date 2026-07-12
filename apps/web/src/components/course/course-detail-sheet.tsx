import type {
  Course,
  DeliveryMode,
  DivisionalEnrolmentIndicators,
  EnrolmentControl,
  MeetingTime,
  Section,
  SectionCode,
  TeachMethod,
} from "@better-ttb/shared";
import { formatDay, millisofdayToHHMM } from "@better-ttb/shared";
import { ChevronDown, ChevronRight, Pin, PinOff, RefreshCw } from "lucide-react";
import * as React from "react";

import buildings from "@/data/buildings.json";
import type { RequisiteGraph } from "@/lib/requisites/graph";
import {
  enrolmentControlLineItems,
  enrolmentIndicatorDescription,
} from "@/lib/enrolment";
import {
  DELIVERY_MODE_LABELS,
  getCourseBreadthCodes,
} from "@/lib/search";
import { sanitizeHtml, stripHtml } from "@/lib/sanitize";
import {
  getSectionAvailability,
  isSectionWaitlisted,
  selectedOthersFor,
  type SectionAvailability,
} from "@/lib/section-status";
import {
  courseKey,
  sectionConflictsWithPlan,
  type PlanSelectedSection,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import type { Plan } from "@/stores/plan";
import { useCatalogStore } from "@/stores/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProfRating } from "@/components/prof-rating";
import { MiniPrereqTree } from "./mini-prereq-tree";
import { RequisiteView } from "./requisite-view";

interface BuildingRecord {
  code: string;
  name: string;
  shortName: string;
  address: string;
  lat: number;
  lng: number;
  source: string;
}

const buildingByCode = new Map(
  (buildings as BuildingRecord[]).map((building) => [building.code, building]),
);

export function CourseDetailSheet({
  course,
  activePlan,
  planSelectedSections,
  refreshError,
  refreshing,
  pinned,
  onChoose,
  onClearChoice,
  onOpenChange,
  onPin,
  onUnpin,
  onRefresh,
  onOpenCourse,
  graph,
}: {
  course: Course | null;
  activePlan: Plan;
  planSelectedSections: readonly PlanSelectedSection[];
  refreshError: string | null;
  refreshing: boolean;
  pinned: boolean;
  onChoose: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
    sectionName: string,
  ) => void;
  onClearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
  onOpenChange: (open: boolean) => void;
  onPin: (course: Course) => void;
  onUnpin: (course: Course) => void;
  onRefresh: (course: Course) => void;
  onOpenCourse?: (code: string) => void;
  graph?: RequisiteGraph | null;
}) {
  const chosenForCourse = course
    ? activePlan.pinned.find(
        (entry) =>
          entry.courseCode === course.code &&
          entry.sectionCode === course.sectionCode,
      )?.chosen ?? {}
    : {};
  return (
    <Sheet open={course !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-hidden p-0 sm:max-w-3xl">
        {course && (
          <>
            <SheetHeader className="border-b p-5 pr-14">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-xl">{course.code}</SheetTitle>
                    <SectionBadge sectionCode={course.sectionCode} />
                    <Badge variant="outline">{course.maxCredit.toFixed(1)} credit</Badge>
                  </div>
                  <SheetDescription className="text-base text-foreground">
                    {course.name}
                  </SheetDescription>
                  <p className="text-sm text-muted-foreground">
                    {course.department.name}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={() => onRefresh(course)}
                    disabled={refreshing}
                  >
                    <RefreshCw className={cn(refreshing && "animate-spin")} />
                    Refresh seats
                  </Button>
                  <Button
                    type="button"
                    variant={pinned ? "secondary" : "default"}
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={() => (pinned ? onUnpin(course) : onPin(course))}
                  >
                    {pinned ? <PinOff /> : <Pin />}
                    {pinned ? "Pinned" : "Pin"}
                  </Button>
                </div>
              </div>
              {refreshError && <p className="text-sm text-destructive">{refreshError}</p>}
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <CourseDetailBody
                course={course}
                chosen={chosenForCourse}
                planSelectedSections={planSelectedSections}
                onChoose={onChoose}
                onClearChoice={onClearChoice}
                onOpenCourse={onOpenCourse}
                graph={graph ?? null}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function CourseDetailBody({
  course,
  chosen,
  planSelectedSections,
  onChoose,
  onClearChoice,
  onOpenCourse,
  graph = null,
}: {
  course: Course;
  chosen: Record<TeachMethod, string | null>;
  planSelectedSections: readonly PlanSelectedSection[];
  onChoose: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
    sectionName: string,
  ) => void;
  onClearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
  onOpenCourse?: ((code: string) => void) | undefined;
  graph?: RequisiteGraph | null;
}) {
  const divisionalEnrolmentIndicators = useCatalogStore(
    (state) => state.divisionalEnrolmentIndicators,
  );
  const info = course.cmCourseInfo;
  const breadths = getCourseBreadthCodes(course);
  const groupedSections = groupSectionsByTeachMethod(course.sections);
  const courseKeyValue = courseKey(course);
  const visibleNotes = course.notes.filter(
    (note) => stripHtml(note.content).length > 0,
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Description</h3>
        <div
          className="prose prose-sm max-w-none text-sm leading-6 text-muted-foreground [&_a]:text-primary [&_li]:ml-4 [&_ul]:list-disc"
          dangerouslySetInnerHTML={{
            __html:
              sanitizeHtml(info?.description ?? null) ||
              "<p>No course description is available.</p>",
          }}
        />
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <RequisiteView
          title="Prerequisites"
          html={info?.prerequisitesText ?? null}
          graph={graph}
          onOpenCourse={onOpenCourse}
        />
        <RequisiteView
          title="Corequisites"
          html={info?.corequisitesText ?? null}
          graph={graph}
          onOpenCourse={onOpenCourse}
        />
        <RequisiteView
          title="Exclusions"
          html={info?.exclusionsText ?? null}
          graph={graph}
          onOpenCourse={onOpenCourse}
          flat
        />
        <RequisiteView
          title="Recommended preparation"
          html={info?.recommendedPreparation ?? null}
          graph={graph}
          onOpenCourse={onOpenCourse}
        />
      </div>

      {graph && (
        <MiniPrereqTree
          code={course.code}
          graph={graph}
          onOpenCourse={onOpenCourse}
        />
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Breadth</h3>
        <div className="flex flex-wrap gap-1.5">
          {breadths.length > 0 ? (
            breadths.map((breadth) => (
              <Badge key={breadth} variant="secondary">
                {formatBreadth(breadth)}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No breadth listed</span>
          )}
        </div>
      </section>

      {visibleNotes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Notes</h3>
          <div className="space-y-2">
            {visibleNotes.map((note, index) => (
              <div
                key={`${note.name}-${index}`}
                className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.content) }}
              />
            ))}
          </div>
        </section>
      )}

      <EnrolmentControlsPanel
        course={course}
        indicators={divisionalEnrolmentIndicators}
      />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Sections</h3>
        {groupedSections.map(([teachMethod, sections]) => {
          // Sections chosen for this course's OTHER teach methods gate the
          // availability (linkage) of every row in this group.
          const selectedOthers = selectedOthersFor(course, chosen, teachMethod);

          return (
          <div key={teachMethod} className="overflow-hidden rounded-md border">
            <div className="border-b bg-muted/50 px-3 py-2 text-sm font-medium">
              {teachMethod}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left font-medium">Pin</th>
                    <th className="px-3 py-2 text-left font-medium">Section</th>
                    <th className="px-3 py-2 text-left font-medium">Meetings</th>
                    <th className="px-3 py-2 text-left font-medium">Instructor</th>
                    <th className="px-3 py-2 text-left font-medium">Seats</th>
                    <th className="px-3 py-2 text-left font-medium">Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((section) => {
                    const isChosen = (chosen[teachMethod] ?? null) === section.name;
                    const conflict = sectionConflictsWithPlan(
                      section,
                      course.sectionCode,
                      courseKeyValue,
                      planSelectedSections,
                    );
                    const availability = getSectionAvailability(
                      section,
                      selectedOthers,
                    );

                    return (
                      <SectionRow
                        key={section.name}
                        section={section}
                        chosen={isChosen}
                        conflict={conflict}
                        availability={availability}
                        onToggle={() => {
                          if (isChosen) {
                            onClearChoice(
                              course.code,
                              course.sectionCode,
                              teachMethod,
                            );
                          } else {
                            onChoose(
                              course.code,
                              course.sectionCode,
                              teachMethod,
                              section.name,
                            );
                          }
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          );
        })}
      </section>
    </div>
  );
}

export function RequirementBlock({
  title,
  html,
}: {
  title: string;
  html: string | null;
}) {
  const sanitized = sanitizeHtml(html);

  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {sanitized ? (
        <div
          className="text-sm leading-6 text-muted-foreground [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">None listed</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Enrolment controls panel
// ---------------------------------------------------------------------------

/**
 * Groups the course's sections by distinct `enrolmentInd` code and renders
 * a description + line-item list for each group.  Sections with controls but
 * no indicator code are collected under a generic "Restricted" group.
 * The panel is omitted entirely when no section carries any enrolment info.
 */
function EnrolmentControlsPanel({
  course,
  indicators,
}: {
  course: Course;
  indicators: DivisionalEnrolmentIndicators;
}) {
  // Build groups: Map<indicatorCode, { sections, controls }>
  // "" key = no indicator but has controls
  type Group = { sections: Section[]; controls: EnrolmentControl[] };
  const groups = new Map<string, Group>();

  for (const section of course.sections) {
    const ind = section.enrolmentInd ?? "";
    const hasControls = section.enrolmentControls.length > 0;

    if (!ind && !hasControls) {
      continue;
    }

    const key = ind || "";

    if (!groups.has(key)) {
      groups.set(key, { sections: [], controls: [] });
    }

    // Non-null assertion safe: we just set it above
    const group = groups.get(key)!;
    group.sections.push(section);

    // Merge controls, de-duplicating by reference identity isn't needed —
    // the line-item algorithm dedupes output strings.
    for (const c of section.enrolmentControls) {
      group.controls.push(c);
    }
  }

  // Also ensure sections with empty ind but no controls aren't shown
  // (they were skipped above). Re-check the "" key.
  const emptyGroup = groups.get("");
  if (emptyGroup && emptyGroup.controls.length === 0) {
    groups.delete("");
  }

  if (groups.size === 0) {
    return null;
  }

  const divisionCode = course.faculty?.code ?? "";
  const codes = [...groups.keys()].filter(Boolean);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Enrolment controls</h3>
        {codes.map((code) => (
          <Badge key={code} variant="secondary">
            {code}
          </Badge>
        ))}
      </div>
      <div className="space-y-2">
        {[...groups.entries()].map(([code, group]) => (
          <EnrolmentControlGroup
            key={code || "__unrestricted__"}
            code={code}
            group={group}
            indicators={indicators}
            divisionCode={divisionCode}
          />
        ))}
      </div>
    </section>
  );
}

function EnrolmentControlGroup({
  code,
  group,
  indicators,
  divisionCode,
}: {
  code: string;
  group: { sections: Section[]; controls: EnrolmentControl[] };
  indicators: DivisionalEnrolmentIndicators;
  divisionCode: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const sectionNames = group.sections.map((s) => s.name).join(", ");
  const heading = code ? `${code} — ${sectionNames}` : sectionNames;
  const description = code
    ? enrolmentIndicatorDescription(indicators, divisionCode, code)
    : null;
  const lineItems = enrolmentControlLineItems(group.controls);

  return (
    <div className="rounded-md border bg-muted/30 text-sm text-muted-foreground">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 p-3 text-left font-medium text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{heading}</span>
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          {description ? (
            <div
              className="[&_a]:text-primary"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }}
            />
          ) : code ? (
            <p className="text-muted-foreground">
              Enrolment restrictions apply to this activity. Check the official
              timetable for details.
            </p>
          ) : null}
          {lineItems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {lineItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SectionRow({
  section,
  chosen,
  conflict,
  availability,
  onToggle,
}: {
  section: Section;
  chosen: boolean;
  conflict: PlanSelectedSection | null;
  availability: SectionAvailability;
  onToggle: () => void;
}) {
  const cancelled = section.cancelInd === "Y";
  // A row can be disallowed for reasons other than cancellation (linkage,
  // closed). Cancelled rows keep their existing line-through look; the extra
  // muted-row treatment applies to the non-cancelled disallowed cases.
  const disallowed = availability.disabled;
  const disallowedNotCancelled = disallowed && !cancelled;
  // Only block the toggle for rows the user has NOT chosen: a chosen-but-now-
  // disallowed row must keep an active unpin button so it can be cleared.
  const toggleDisabled = disallowed && !chosen;

  return (
    <tr
      className={cn(
        "border-t",
        cancelled && "text-muted-foreground line-through",
        disallowedNotCancelled && "bg-muted/40 opacity-70",
        chosen && "bg-primary/5",
        conflict && !chosen && "bg-destructive/5",
      )}
    >
      <td className="px-3 py-3 align-top">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={chosen ? "secondary" : "ghost"}
              size="icon-xs"
              disabled={toggleDisabled}
              onClick={onToggle}
            >
              {chosen ? <PinOff /> : <Pin />}
              <span className="sr-only">
                {chosen ? "Clear choice (back to Auto)" : "Pin this section"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {chosen ? "Clear choice — back to Auto" : "Pin course and choose this section"}
          </TooltipContent>
        </Tooltip>
      </td>
      <td className="px-3 py-3 align-top font-medium">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5">
            {section.name}
            {section.enrolmentInd && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-muted-foreground">
                {section.enrolmentInd}
              </Badge>
            )}
            {isSectionWaitlisted(section) && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-amber-700 dark:text-amber-400">
                WL
              </Badge>
            )}
          </span>
          {conflict && (
            <div className="text-xs font-normal text-destructive no-underline">
              Conflicts with {conflict.courseCode} {conflict.section.name}
            </div>
          )}
          {disallowedNotCancelled && availability.reason && (
            <div className="text-xs font-normal text-muted-foreground no-underline">
              {availability.reason}
            </div>
          )}
        </div>
      </td>
      <td className="max-w-[280px] px-3 py-3 align-top">
        {section.meetingTimes.length > 0 ? (
          <div className="space-y-1">
            {section.meetingTimes.map((meeting, index) => (
              <div key={`${section.name}-${index}`}>
                <span>{formatMeetingTime(meeting)}</span>
                <span className="mx-1 text-muted-foreground">·</span>
                <BuildingLocation meeting={meeting} />
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">TBA</span>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        <SectionInstructors section={section} />
      </td>
      <td className="px-3 py-3 align-top">
        <div className="space-y-1">
          <span>
            {section.currentEnrolment}/{section.maxEnrolment}
          </span>
          {section.currentWaitlist > 0 && (
            <div className="text-xs text-muted-foreground">
              {section.currentWaitlist} waitlisted
            </div>
          )}
        </div>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex flex-wrap gap-1">
          {getSectionDeliveryModes(section).map((mode) => (
            <Badge key={mode} variant="outline">
              {DELIVERY_MODE_LABELS[mode]}
            </Badge>
          ))}
        </div>
      </td>
    </tr>
  );
}

function BuildingLocation({ meeting }: { meeting: MeetingTime }) {
  const buildingCode = meeting.building.buildingCode;
  const room = formatRoom(meeting);
  const building = buildingByCode.get(buildingCode);
  const label = buildingCode ? `${buildingCode}${room}` : "TBA";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="underline decoration-dotted underline-offset-2">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {building?.name ?? meeting.building.buildingName ?? buildingCode}
      </TooltipContent>
    </Tooltip>
  );
}

export function SectionBadge({ sectionCode }: { sectionCode: SectionCode }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        sectionCode === "F" &&
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
        sectionCode === "S" &&
          "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
        sectionCode === "Y" &&
          "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300",
      )}
    >
      {sectionCode}
    </Badge>
  );
}

const BREADTH_NAMES: Record<string, string> = {
  "1": "Creative and Cultural Representations",
  "2": "Thought, Belief, and Behaviour",
  "3": "Society and Its Institutions",
  "4": "Living Things and Their Environment",
  "5": "The Physical and Mathematical Universes",
};

export function formatBreadth(breadth: string): string {
  const match = breadth.match(/([1-5])$/);
  if (!match?.[1]) return breadth;
  const name = BREADTH_NAMES[match[1]];
  return name ? `BR ${match[1]}: ${name}` : `BR ${match[1]}`;
}

/** Compact breadth label ("BR 3") for space-constrained UI like result cards. */
export function formatBreadthShort(breadth: string): string {
  const match = breadth.match(/([1-5])$/);
  return match?.[1] ? `BR ${match[1]}` : breadth;
}

export function groupSectionsByTeachMethod(
  sections: readonly Section[],
): Array<[TeachMethod, Section[]]> {
  const groups = new Map<TeachMethod, Section[]>();

  sections.forEach((section) => {
    groups.set(section.teachMethod, [
      ...(groups.get(section.teachMethod) ?? []),
      section,
    ]);
  });

  return [...groups.entries()].sort(([left], [right]) =>
    teachMethodRank(left) - teachMethodRank(right) || left.localeCompare(right),
  );
}

export function getTeachMethods(sections: readonly Section[]): TeachMethod[] {
  return groupSectionsByTeachMethod(sections).map(([teachMethod]) => teachMethod);
}

function teachMethodRank(teachMethod: TeachMethod): number {
  if (teachMethod === "LEC") {
    return 0;
  }

  if (teachMethod === "TUT") {
    return 1;
  }

  if (teachMethod === "PRA") {
    return 2;
  }

  return 3;
}

export function formatMeetingTime(meeting: MeetingTime): string {
  return `${formatDay(meeting.start.day)} ${millisofdayToHHMM(
    meeting.start.millisofday,
  )}-${millisofdayToHHMM(meeting.end.millisofday)}`;
}

export function formatRoom(meeting: MeetingTime): string {
  const number = meeting.building.buildingRoomNumber;
  const suffix = meeting.building.buildingRoomSuffix;

  return `${number}${suffix}`.trim();
}

function SectionInstructors({ section }: { section: Section }) {
  const instructors = section.instructors.filter(
    (instructor) => instructor.firstName || instructor.lastName,
  );

  if (instructors.length === 0) {
    return <span className="text-muted-foreground">TBA</span>;
  }

  return (
    <>
      {instructors.map((instructor, index) => (
        <React.Fragment key={`${instructor.firstName}-${instructor.lastName}-${index}`}>
          {index > 0 && ", "}
          <span className="whitespace-nowrap">
            {`${instructor.firstName} ${instructor.lastName}`.trim()}
            <ProfRating
              firstName={instructor.firstName}
              lastName={instructor.lastName}
            />
          </span>
        </React.Fragment>
      ))}
    </>
  );
}

function getSectionDeliveryModes(section: Section): DeliveryMode[] {
  const modes = new Set<DeliveryMode>(
    section.deliveryModes.map((deliveryMode) => deliveryMode.mode),
  );

  if (section.tbaInd === "Y" || section.meetingTimes.length === 0) {
    modes.add("ASYNC");
  }

  return [...modes].sort();
}
