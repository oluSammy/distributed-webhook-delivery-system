import { Webhook } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/api";
import type { Endpoint } from "@/lib/endpoints";
import { CreateEndpoint } from "./CreateEndpoint";
import { EndpointList } from "./EndpointList";

export const metadata: Metadata = { title: "Endpoints · Webhooks" };

export default function EndpointsPage() {
  return (
    <>
      <TopBar title="Endpoints" subtitle="URLs that receive your webhooks">
        <CreateEndpoint />
      </TopBar>
      <Suspense fallback={<LoadingEndpoints />}>
        <Endpoints />
      </Suspense>
    </>
  );
}

async function Endpoints() {
  const { endpoints } = await apiGet<{ endpoints: Endpoint[] }>("/api/endpoints");
  if (endpoints.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <Webhook aria-hidden className="size-6 text-fg-3" />
        <h2 className="text-[15px] font-semibold">No endpoints yet</h2>
        <p className="max-w-md text-fg-2">
          An endpoint is a URL on your customer's server. Add one, choose the event types it should
          get, and every matching event is signed and delivered to it, with retries when it's down.
        </p>
        <CreateEndpoint size="lg" />
      </Card>
    );
  }
  return <EndpointList endpoints={endpoints} />;
}

function LoadingEndpoints() {
  return (
    <section aria-busy="true" aria-label="Loading endpoints" className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Skeleton className="h-8.5 w-16 rounded-full" />
        <Skeleton className="h-8.5 w-20 rounded-full" />
        <Skeleton className="h-8.5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-72 w-full rounded-inset" />
    </section>
  );
}
