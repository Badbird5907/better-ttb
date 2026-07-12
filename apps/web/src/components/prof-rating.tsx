import { Star } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { fetchProfRating, type RmpLookupResult } from "@/lib/rmp-client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Colour the rating text by score: green for strong, amber for middling, red for
 * weak. Uses light/dark pairs consistent with the rest of the app.
 */
function ratingColorClass(avgRating: number): string {
  if (avgRating >= 4) {
    return "text-emerald-600 dark:text-emerald-400";
  }

  if (avgRating >= 3) {
    return "text-amber-600 dark:text-amber-400";
  }

  return "text-red-600 dark:text-red-400";
}

/**
 * Inline Rate My Professors rating for a single instructor. Renders nothing while
 * loading, on failure, or when no match is found. When found it shows a filled
 * star + average rating linking out to RMP, with details in a tooltip.
 *
 * Relies on an ancestor {@link TooltipProvider} (present at the page root).
 */
export function ProfRating({
  firstName,
  lastName,
}: {
  firstName: string;
  lastName: string;
}) {
  const [result, setResult] = React.useState<RmpLookupResult | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();

    setResult(null);

    fetchProfRating(firstName, lastName, controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setResult(value);
      }
    });

    return () => controller.abort();
  }, [firstName, lastName]);

  if (!result || !result.found || !result.rating || !result.rmpUrl) {
    return null;
  }

  const { rating, rmpUrl, matchConfidence } = result;
  const hasWouldTakeAgain = rating.wouldTakeAgainPercent >= 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={rmpUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "ml-1 inline-flex items-center gap-0.5 align-middle text-xs font-medium tabular-nums hover:underline",
            ratingColorClass(rating.avgRating),
          )}
        >
          <Star className="size-3 fill-current" />
          {rating.avgRating.toFixed(1)}
        </a>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5">
          <div className="font-medium">Rate My Professors</div>
          <div>
            Rating {rating.avgRating.toFixed(1)}/5 ({rating.numRatings}{" "}
            {rating.numRatings === 1 ? "rating" : "ratings"})
          </div>
          <div>Difficulty {rating.avgDifficulty.toFixed(1)}/5</div>
          {hasWouldTakeAgain && (
            <div>
              {rating.wouldTakeAgainPercent.toFixed(0)}% would take again
            </div>
          )}
          {rating.department && <div>{rating.department}</div>}
          {matchConfidence === "high" && (
            <div className="text-background/70">name match approximate</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
