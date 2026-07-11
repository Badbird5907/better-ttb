import type { ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Layers, MapIcon } from "lucide-react";

export const Route = createFileRoute("/map")({
  component: MapStub,
});

function MapStub() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Layers className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold">better-ttb</h1>
            <p className="text-xs text-muted-foreground">Map</p>
          </div>
        </div>
        <nav className="flex items-center rounded-md bg-muted p-1">
          <StubTab to="/" label="Build" />
          <StubTab to="/timetable" label="Timetable" />
          <StubTab to="/map" label="Map" icon={<MapIcon className="size-3.5" />} />
        </nav>
      </header>
      <section className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md rounded-md border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">Map coming in next phase</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Building data is wired into course details for room tooltips.
          </p>
        </div>
      </section>
    </main>
  );
}

function StubTab({
  to,
  label,
  icon,
}: {
  to: "/" | "/timetable" | "/map";
  label: string;
  icon?: ReactNode;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      activeProps={{ className: "bg-background text-foreground shadow-xs" }}
      className="inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  );
}
