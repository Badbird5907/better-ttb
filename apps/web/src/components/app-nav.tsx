import { Link } from "@tanstack/react-router";
import { CalendarDays, Layers, MapIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type NavPath = "/" | "/timetable" | "/map";

interface NavEntry {
  to: NavPath;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ENTRIES: NavEntry[] = [
  { to: "/", label: "Build", icon: Layers },
  { to: "/timetable", label: "Timetable", icon: CalendarDays },
  { to: "/map", label: "Map", icon: MapIcon },
];

// Desktop pill nav. Markup/styles mirror the former per-route NavTab.
// The Build tab always matches exactly so /timetable and /map don't keep it lit.
export function AppNav() {
  return (
    <nav className="hidden items-center rounded-md bg-muted p-1 md:flex">
      {NAV_ENTRIES.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === "/" }}
          activeProps={{ className: "bg-background text-foreground shadow-xs" }}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {to !== "/" && <Icon className="size-3.5" />}
          {label}
        </Link>
      ))}
    </nav>
  );
}

// Fixed bottom tab bar for phones. Sits above content (callers add pb-16 md:pb-0
// on their scroll container) and respects the iOS home-indicator safe area.
export function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex">
        {NAV_ENTRIES.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-muted-foreground transition-colors"
            activeProps={{ className: "text-foreground" }}
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "absolute inset-x-6 top-0 h-0.5 rounded-full",
                    isActive ? "bg-foreground" : "bg-transparent",
                  )}
                />
                <Icon className="size-5" />
                <span className="text-[11px] leading-none">{label}</span>
              </>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
