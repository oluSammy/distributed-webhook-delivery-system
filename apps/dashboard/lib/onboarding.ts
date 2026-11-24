// GET /api/onboarding: how far the workspace is through getting started.
export type Onboarding = {
  steps: { event_type: boolean; endpoint: boolean; delivered: boolean; event_sent: boolean };
  event_type: string | null; // the first registered type, for the curl example
  endpoint_id: string | null; // the first endpoint, to send a test to
};

export function onboardingDone(onboarding: Onboarding): boolean {
  return Object.values(onboarding.steps).every(Boolean);
}
