import { getPostHogClient } from "@/utils/posthog-server";

export function captureServerEvent(
  event: string,
  properties: Record<string, unknown>,
): void {
  if (import.meta.env.MODE === "test") {
    return;
  }
  try {
    getPostHogClient().capture({
      distinctId: "system:catalog-maintenance",
      event,
      properties,
    });
  } catch (error) {
    console.warn("Server telemetry capture failed", {
      event,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
