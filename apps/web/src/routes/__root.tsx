import { useEffect, type ReactNode } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { PostHogProvider } from "@posthog/react";

import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "better-ttb" },
      {
        name: "description",
        content: "A UofT timetable builder.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }),
  component: RootComponent,
});

function RootComponent() {
  // Client-only: keep plan state in sync with edits made in other tabs.
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    void import("@/stores/plan").then(({ subscribeToPlanStorageSync }) => {
      if (!disposed) {
        unsubscribe = subscribeToPlanStorageSync();
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <PostHogProvider
          apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!}
          options={{
            api_host: "/ingest",
            ui_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.posthog.com",
            defaults: "2025-05-24",
            capture_exceptions: true,
            debug: import.meta.env.DEV,
          }}
        >
          <TooltipProvider>{children}</TooltipProvider>
        </PostHogProvider>
        <Scripts />
      </body>
    </html>
  );
}
