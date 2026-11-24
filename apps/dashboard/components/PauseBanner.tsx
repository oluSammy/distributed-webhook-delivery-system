import { CirclePause } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { Banner } from "@/components/ui/Banner";
import { getMe } from "@/lib/api";

// Shown above every page while an operator has paused sending, for this workspace or for everyone.
// Nothing is lost meanwhile: events are accepted, and their deliveries wait to be sent. Uses the
// same /api/me answer as the sidebar (getMe is cached per page view), so it costs no request.
export async function PauseBanner() {
  let paused: { workspace: boolean; everyone: boolean };
  try {
    paused = (await getMe()).paused;
  } catch (error) {
    unstable_rethrow(error);
    return null; // the page shows its own error
  }
  if (!paused.everyone && !paused.workspace) {
    return null;
  }
  return (
    <Banner tone="pause" icon={CirclePause}>
      <strong>
        {paused.everyone
          ? "Sending is paused for everyone, for maintenance."
          : "Sending is paused for this workspace."}
      </strong>{" "}
      Events are still accepted, and their deliveries wait: nothing is sent until it's resumed.
    </Banner>
  );
}
