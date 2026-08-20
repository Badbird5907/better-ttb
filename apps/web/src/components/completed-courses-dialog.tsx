import { GraduationCap } from "lucide-react";

import { CompletedCoursesManager } from "@/components/completed-courses/manager";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Header entry point for the completed-courses editor. The dialog is only a
 * shell — everything lives in `CompletedCoursesManager`, which is also embedded
 * on the degree page.
 */
export function CompletedCoursesButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm">
          <GraduationCap />
          <span className="sr-only">My courses</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>My completed courses</DialogTitle>
          <DialogDescription>
            These courses are highlighted green in prerequisite views. Grade is
            optional and is only used for prerequisites requiring a minimum %.
          </DialogDescription>
        </DialogHeader>

        <CompletedCoursesManager />
      </DialogContent>
    </Dialog>
  );
}
