import * as React from "react";
import type { DayNumber } from "@better-ttb/shared";
import { formatDay, millisofdayToHHMM } from "@better-ttb/shared";

import { cn } from "@/lib/utils";
import type { TimetableBlock } from "@/lib/timetable";

export interface BlockedWindow {
  day: DayNumber;
  startMillis: number;
  endMillis: number;
}

interface WeekGridProps {
  blocks: TimetableBlock[];
  blockedWindows?: BlockedWindow[];
  blockoutEnabled?: boolean;
  compact?: boolean;
  className?: string;
  onBlockClick?: (block: TimetableBlock) => void;
  onPaintCell?: (day: DayNumber, startMillis: number, endMillis: number) => void;
}

interface LaidOutBlock extends TimetableBlock {
  lane: number;
  laneCount: number;
}

const CELL_MILLIS = 30 * 60 * 1000;
const HOUR_MILLIS = 60 * 60 * 1000;
const DEFAULT_START = hoursToMillis(8);
const DEFAULT_END = hoursToMillis(22);
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

export function WeekGrid({
  blocks,
  blockedWindows = [],
  blockoutEnabled = false,
  compact = false,
  className,
  onBlockClick,
  onPaintCell,
}: WeekGridProps) {
  const [hoveredCourseKey, setHoveredCourseKey] = React.useState<string | null>(null);
  const paintingRef = React.useRef(false);
  const laidOutBlocks = React.useMemo(() => layoutBlocks(blocks), [blocks]);
  const days = React.useMemo(
    () => visibleDays(blocks, blockedWindows),
    [blockedWindows, blocks],
  );
  const { startMillis, endMillis } = React.useMemo(
    () => visibleTimeBounds(blocks, blockedWindows),
    [blockedWindows, blocks],
  );
  const rowHeight = compact ? 18 : 56;
  const height = ((endMillis - startMillis) / HOUR_MILLIS) * rowHeight;
  // Compact thumbnails must never overflow their card: use zero-min fluid columns
  // (no fixed time axis) so every weekday fits within the available width.
  const gridTemplateColumns = compact
    ? `repeat(${days.length}, minmax(0, 1fr))`
    : `56px repeat(${days.length}, minmax(128px, 1fr))`;
  // Non-compact grids can be wider than a phone; allow horizontal scrolling with
  // a sensible minimum so day columns keep a usable width instead of collapsing.
  const minWidth = compact ? undefined : `${56 + days.length * 128}px`;
  const hours = React.useMemo(
    () => buildHourTicks(startMillis, endMillis),
    [endMillis, startMillis],
  );
  const cells = React.useMemo(
    () => buildPaintCells(startMillis, endMillis),
    [endMillis, startMillis],
  );

  React.useEffect(() => {
    if (!blockoutEnabled) {
      paintingRef.current = false;
      return;
    }

    function stopPainting() {
      paintingRef.current = false;
    }

    window.addEventListener("pointerup", stopPainting);
    return () => window.removeEventListener("pointerup", stopPainting);
  }, [blockoutEnabled]);

  function paintCell(day: DayNumber, start: number, end: number) {
    if (!blockoutEnabled || !onPaintCell) {
      return;
    }

    onPaintCell(day, start, end);
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-background",
        compact ? "overflow-hidden rounded-sm text-[8px]" : "overflow-x-auto",
        className,
      )}
    >
      <div style={{ minWidth }}>
      <div
        className="grid border-b bg-muted/50"
        style={{ gridTemplateColumns }}
      >
        {!compact && <div className="sticky left-0 z-40 bg-muted/50" />}
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "border-l px-2 py-2 text-center text-xs font-medium",
              compact && "border-l-0 px-0 py-0.5 text-[7px] leading-none",
            )}
          >
            {compact ? formatDay(day).charAt(0) : formatDay(day)}
          </div>
        ))}
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns, gridTemplateRows: `${height}px` }}
      >
        {!compact && (
          <div className="relative sticky left-0 z-40 bg-muted/20" style={{ height }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-1 -translate-y-2 text-[10px] text-muted-foreground"
                style={{ top: percent(hour, startMillis, endMillis) }}
              >
                {millisofdayToHHMM(hour)}
              </div>
            ))}
          </div>
        )}

        {days.map((day) => {
          const dayBlocks = laidOutBlocks.filter((block) => block.day === day);
          const dayBlocked = blockedWindows.filter((window) => window.day === day);

          return (
            <div
              key={day}
              className="relative border-l bg-background"
              style={{ height }}
            >
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-border/70"
                  style={{ top: percent(hour, startMillis, endMillis) }}
                />
              ))}
              {!compact &&
                cells.map((cellStart) => {
                  const cellEnd = cellStart + CELL_MILLIS;

                  return (
                    <button
                      key={cellStart}
                      type="button"
                      aria-label={`Block ${formatDay(day)} ${millisofdayToHHMM(cellStart)}`}
                      className={cn(
                        "absolute inset-x-0 z-10 cursor-crosshair opacity-0",
                        blockoutEnabled && "opacity-100",
                      )}
                      style={{
                        top: percent(cellStart, startMillis, endMillis),
                        height: percent(CELL_MILLIS, 0, endMillis - startMillis),
                      }}
                      disabled={!blockoutEnabled}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        paintingRef.current = true;
                        paintCell(day, cellStart, cellEnd);
                      }}
                      onPointerEnter={() => {
                        if (paintingRef.current) {
                          paintCell(day, cellStart, cellEnd);
                        }
                      }}
                    />
                  );
                })}
              {dayBlocked.map((window, index) => (
                <div
                  key={`${window.day}-${window.startMillis}-${window.endMillis}-${index}`}
                  className="pointer-events-none absolute inset-x-1 z-20 rounded-sm border border-amber-500/40 bg-[repeating-linear-gradient(135deg,rgba(245,158,11,0.2),rgba(245,158,11,0.2)_4px,rgba(245,158,11,0.05)_4px,rgba(245,158,11,0.05)_8px)]"
                  style={{
                    top: percent(window.startMillis, startMillis, endMillis),
                    height: percent(
                      window.endMillis - window.startMillis,
                      0,
                      endMillis - startMillis,
                    ),
                  }}
                />
              ))}
              {dayBlocks.map((block) => {
                const faded =
                  hoveredCourseKey !== null && hoveredCourseKey !== block.courseKey;
                const left = `${(block.lane / block.laneCount) * 100}%`;
                const width = `${100 / block.laneCount}%`;

                return (
                  <button
                    key={block.id}
                    type="button"
                    className={cn(
                      "absolute z-30 overflow-hidden rounded-md border p-2 text-left text-white shadow-sm transition-opacity",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      block.conflict && "border-red-600 ring-1 ring-red-600",
                      !block.conflict && block.disallowed && "opacity-60 saturate-50 ring-1 ring-slate-500",
                      block.preview && "border-dashed",
                      faded && "opacity-35",
                      compact && "rounded-sm border p-0.5 shadow-none",
                    )}
                    style={{
                      top: percent(block.startMillis, startMillis, endMillis),
                      height: percent(
                        block.endMillis - block.startMillis,
                        0,
                        endMillis - startMillis,
                      ),
                      left,
                      width,
                      backgroundColor: block.color,
                      borderColor: block.conflict
                        ? "#dc2626"
                        : block.disallowed
                          ? "#64748b"
                          : "rgba(255,255,255,0.55)",
                    }}
                    onClick={() => onBlockClick?.(block)}
                    onMouseEnter={() => setHoveredCourseKey(block.courseKey)}
                    onMouseLeave={() => setHoveredCourseKey(null)}
                  >
                    {compact ? (
                      <span className="block truncate font-semibold leading-none">
                        {block.courseCode.replace(/[A-Z]1$/, "")}
                      </span>
                    ) : (
                      <span className="flex h-full min-h-0 flex-col gap-0.5">
                        <span className="truncate text-xs font-semibold leading-tight">
                          {block.courseCode}
                        </span>
                        <span className="truncate text-[11px] leading-tight">
                          {block.sectionName}
                        </span>
                        <span className="truncate text-[10px] leading-tight text-white/85">
                          {block.room}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function layoutBlocks(blocks: readonly TimetableBlock[]): LaidOutBlock[] {
  return DAY_NUMBERS.flatMap((day) => layoutDayBlocks(blocks.filter((block) => block.day === day)));
}

function layoutDayBlocks(blocks: readonly TimetableBlock[]): LaidOutBlock[] {
  const sorted = [...blocks].sort(
    (left, right) =>
      left.startMillis - right.startMillis ||
      left.endMillis - right.endMillis ||
      left.id.localeCompare(right.id),
  );
  const result: LaidOutBlock[] = [];
  let cluster: TimetableBlock[] = [];
  let clusterEnd = -1;

  function flushCluster() {
    if (cluster.length === 0) {
      return;
    }

    result.push(...assignLanes(cluster));
    cluster = [];
    clusterEnd = -1;
  }

  sorted.forEach((block) => {
    if (cluster.length > 0 && block.startMillis >= clusterEnd) {
      flushCluster();
    }

    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMillis);
  });

  flushCluster();
  return result;
}

function assignLanes(cluster: readonly TimetableBlock[]): LaidOutBlock[] {
  const laneEnds: number[] = [];
  const assigned = cluster.map((block) => {
    const lane = laneEnds.findIndex((end) => end <= block.startMillis);
    const laneIndex = lane === -1 ? laneEnds.length : lane;
    laneEnds[laneIndex] = block.endMillis;

    return { block, lane: laneIndex };
  });
  const laneCount = Math.max(1, laneEnds.length);

  return assigned.map(({ block, lane }) => ({
    ...block,
    lane,
    laneCount,
  }));
}

function visibleDays(
  blocks: readonly TimetableBlock[],
  blockedWindows: readonly BlockedWindow[],
): DayNumber[] {
  const days = new Set<DayNumber>([1, 2, 3, 4, 5]);

  blocks.forEach((block) => {
    if (block.day > 5) {
      days.add(block.day);
    }
  });
  blockedWindows.forEach((window) => {
    if (window.day > 5) {
      days.add(window.day);
    }
  });

  return DAY_NUMBERS.filter((day) => days.has(day));
}

function visibleTimeBounds(
  blocks: readonly TimetableBlock[],
  blockedWindows: readonly BlockedWindow[],
): { startMillis: number; endMillis: number } {
  const starts = [
    DEFAULT_START,
    ...blocks.map((block) => block.startMillis),
    ...blockedWindows.map((window) => window.startMillis),
  ];
  const ends = [
    DEFAULT_END,
    ...blocks.map((block) => block.endMillis),
    ...blockedWindows.map((window) => window.endMillis),
  ];
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);

  return {
    startMillis: Math.max(0, Math.floor(minStart / HOUR_MILLIS) * HOUR_MILLIS),
    endMillis: Math.min(24 * HOUR_MILLIS, Math.ceil(maxEnd / HOUR_MILLIS) * HOUR_MILLIS),
  };
}

function buildHourTicks(startMillis: number, endMillis: number): number[] {
  const ticks: number[] = [];

  for (let tick = startMillis; tick <= endMillis; tick += HOUR_MILLIS) {
    ticks.push(tick);
  }

  return ticks;
}

function buildPaintCells(startMillis: number, endMillis: number): number[] {
  const cells: number[] = [];

  for (let tick = startMillis; tick < endMillis; tick += CELL_MILLIS) {
    cells.push(tick);
  }

  return cells;
}

function hoursToMillis(hour: number): number {
  return hour * HOUR_MILLIS;
}

function percent(value: number, start: number, end: number): string {
  if (end <= start) {
    return "0%";
  }

  return `${((value - start) / (end - start)) * 100}%`;
}
