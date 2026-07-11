import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-6 py-16">
        <div className="space-y-4">
          <Badge variant="secondary" className="w-fit">
            UofT timetable builder
          </Badge>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-normal sm:text-5xl">better-ttb</h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Build and compare University of Toronto timetables with course data, section
              constraints, and schedule generation.
            </p>
          </div>
          <Button type="button">Start planning</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Courses</CardTitle>
              <CardDescription>Normalized TTB API data.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Shared types model courses, sections, meeting times, and buildings.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Generator</CardTitle>
              <CardDescription>Rules-first engine scaffold.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              The generator package is ready for real timetable search logic.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cloudflare</CardTitle>
              <CardDescription>D1, KV, and cron wiring.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Alchemy provisions bindings for the worker-backed web app.
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
