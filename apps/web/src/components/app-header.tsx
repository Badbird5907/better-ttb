import { usePostHog } from "@posthog/react";
import { Copy, MoreHorizontal, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import * as React from "react";

import { AppNav } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { activePlanFromState, usePlanStore } from "@/stores/plan";

/**
 * Unified site header shared by every page (Build, Timetable, Map, Prereqs).
 *
 * Owns the brand, pill nav, plan switcher, the plan-actions dropdown
 * (new/rename/duplicate/delete), the Share flow (fetch + result dialog), and
 * the theme toggle. It reads the plan store directly so pages don't thread the
 * plan actions as props.
 *
 * `sessionSelector` renders before the plan switcher (the Build page's
 * fall/winter session picker). `actions` renders before Share (page-specific
 * controls such as the Timetable ICS / JSON buttons).
 */
export function AppHeader({
  brandIcon: BrandIcon,
  sessionSelector,
  actions,
  onActivePlanChange,
}: {
  brandIcon: React.ComponentType<{ className?: string }>;
  sessionSelector?: React.ReactNode;
  actions?: React.ReactNode;
  onActivePlanChange?: (planId: string) => void;
}) {
  const posthog = usePostHog();
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const setActivePlan = usePlanStore((state) => state.setActivePlan);
  const newPlan = usePlanStore((state) => state.newPlan);
  const renamePlan = usePlanStore((state) => state.renamePlan);
  const duplicatePlan = usePlanStore((state) => state.duplicatePlan);
  const deletePlan = usePlanStore((state) => state.deletePlan);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );

  const [shareOpen, setShareOpen] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState("");
  const [shareError, setShareError] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState(false);

  function handleSetActivePlan(planId: string) {
    onActivePlanChange?.(planId);
    setActivePlan(planId);
  }

  function handleNewPlan() {
    newPlan(activePlan.sessions);
  }

  function handleRenamePlan() {
    const nextName = window.prompt("Rename plan", activePlan.name);

    if (nextName !== null) {
      renamePlan(activePlan.id, nextName);
    }
  }

  function handleDeletePlan() {
    if (plans.length > 1 && window.confirm(`Delete ${activePlan.name}?`)) {
      deletePlan(activePlan.id);
    }
  }

  async function sharePlan() {
    setSharing(true);
    setShareError(null);

    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PostHog-Session-Id": posthog.get_session_id() ?? "",
          "X-PostHog-Distinct-Id": posthog.get_distinct_id() ?? "",
        },
        body: JSON.stringify({ plan: activePlan }),
      });

      if (!response.ok) {
        throw new Error(`Share failed with HTTP ${response.status}`);
      }

      const body = (await response.json()) as { id?: unknown };

      if (typeof body.id !== "string") {
        throw new Error("Share response did not include an id");
      }

      const url = `${window.location.origin}/p/${body.id}`;
      setShareUrl(url);
      setShareOpen(true);
      posthog.capture("plan_shared", {
        pinned_course_count: activePlan.pinned.length,
      });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
      setShareOpen(true);
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BrandIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">Better TTB</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                By Evan Yu
              </p>
            </div>
          </div>

          <AppNav />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {sessionSelector}

          <Select value={activePlan.id} onValueChange={handleSetActivePlan}>
            <SelectTrigger className="w-[110px] min-w-0 sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon-sm">
                <MoreHorizontal />
                <span className="sr-only">Plan actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={handleNewPlan}>
                <Plus />
                New plan
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleRenamePlan}>
                <Pencil />
                Rename plan
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => duplicatePlan(activePlan.id)}>
                <Copy />
                Duplicate plan
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={plans.length <= 1}
                onSelect={handleDeletePlan}
              >
                <Trash2 />
                Delete plan
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {actions}

          <Button type="button" size="sm" onClick={sharePlan} disabled={sharing}>
            <Share2 />
            <span className="hidden sm:inline">Share</span>
          </Button>

          <ThemeToggle />
        </div>
      </header>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share plan</DialogTitle>
            <DialogDescription>
              Anyone with the URL can view the read-only plan summary.
            </DialogDescription>
          </DialogHeader>
          {shareError ? (
            <p className="text-sm text-destructive">{shareError}</p>
          ) : (
            <div className="flex gap-2">
              <Input readOnly value={shareUrl} />
              <Button
                type="button"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(shareUrl)}
              >
                <Copy />
                Copy
              </Button>
            </div>
          )}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
