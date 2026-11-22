"use client";

import { Pause, Play, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { apiPost, apiRequest, RequestError } from "@/lib/browser-api";
import type { DeliveryDetail } from "@/lib/deliveries";
import { type Endpoint, endpointName } from "@/lib/endpoints";
import { formatDuration } from "@/lib/format";

// The buttons at the top of an endpoint's page.
export function EndpointActions({ endpoint }: { endpoint: Endpoint }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SendTest endpoint={endpoint} />
      <PauseOrResume endpoint={endpoint} />
      <DeleteEndpoint endpoint={endpoint} />
    </div>
  );
}

// How long to watch a test delivery before pointing to its own page instead.
const WATCH_SECONDS = 30;

// Sends a test event, then watches its delivery until the first attempt is recorded, and shows
// what the endpoint answered.
function SendTest({ endpoint }: { endpoint: Endpoint }) {
  const [open, setOpen] = useState(false);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [result, setResult] = useState<DeliveryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  async function send() {
    setError(null);
    setResult(null);
    setGaveUp(false);
    try {
      const sent = await apiPost<{ delivery_id: string }>(`/api/endpoints/${endpoint.id}/test`);
      setDeliveryId(sent.delivery_id);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Couldn't send the test. Try again.");
    }
  }

  // Asks for the delivery once a second until its first attempt is in.
  useEffect(() => {
    if (!deliveryId) {
      return;
    }
    let seconds = 0;
    const timer = setInterval(async () => {
      seconds += 1;
      const response = await fetch(`/api/deliveries/${deliveryId}`);
      const delivery = response.ok ? ((await response.json()) as DeliveryDetail) : null;
      if (delivery && delivery.attempts.length > 0) {
        setResult(delivery);
        clearInterval(timer);
      } else if (seconds >= WATCH_SECONDS) {
        setGaveUp(true);
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deliveryId]);

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setDeliveryId(null);
      setResult(null);
      setError(null);
      setGaveUp(false);
    }
  }

  const attempt = result?.attempts[0];
  const waiting = deliveryId !== null && !result && !gaveUp;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button disabled={endpoint.state !== "active"}>
          <Send aria-hidden />
          Send test event
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Send a test event"
        description={`One signed webhook.test event goes to ${endpointName(endpoint)} only, like any other delivery. It doesn't count as one of your events.`}
      >
        <div aria-live="polite" className="flex flex-col gap-3">
          {waiting && <p className="text-fg-2">Sending to {new URL(endpoint.url).host}…</p>}
          {attempt && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={attempt.outcome === "success" ? "ok" : "fail"}>
                  {attempt.outcome === "success" ? "Delivered" : "Failed"}
                </Badge>
                <span className="font-mono text-[12.5px]">
                  {attempt.response_status ?? attempt.error_kind}
                </span>
                {attempt.latency_ms !== null && (
                  <span className="text-fg-3">{formatDuration(attempt.latency_ms)}</span>
                )}
              </div>
              {attempt.response_body && (
                <CodeBlock code={attempt.response_body} copyLabel="Copy response body" />
              )}
            </>
          )}
          {gaveUp && <p className="text-fg-2">No answer yet. It keeps trying in the background.</p>}
          {error && (
            <p role="alert" className="text-[13px] text-dead">
              {error}
            </p>
          )}
          {deliveryId && (result || gaveUp) && (
            <Link href={`/deliveries/${deliveryId}`} className="text-accent hover:underline">
              Open the delivery
            </Link>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
          <Button variant="primary" onClick={send} disabled={waiting}>
            {deliveryId ? "Send again" : "Send test event"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Pause stops sending (new deliveries wait); resume sends what waited. A disabled endpoint can be
// paused too, which stops its breaker's probes.
function PauseOrResume({ endpoint }: { endpoint: Endpoint }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const paused = endpoint.state === "paused";

  async function run() {
    setBusy(true);
    try {
      await apiPost(`/api/endpoints/${endpoint.id}/${paused ? "resume" : "pause"}`);
      toast(paused ? "Endpoint resumed" : "Endpoint paused");
      router.refresh();
    } catch (err) {
      toast(err instanceof RequestError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? "Resume" : "Pause"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={paused ? `Resume ${endpointName(endpoint)}?` : `Pause ${endpointName(endpoint)}?`}
        description={
          paused
            ? "Sending starts again straight away, with the deliveries that waited, oldest first."
            : "Nothing is sent to this endpoint until you resume it. New deliveries wait, and waiting uses up no attempts. One being sent right now finishes first."
        }
      >
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="primary" onClick={run} disabled={busy}>
              {paused ? "Resume endpoint" : "Pause endpoint"}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Delete, after typing the endpoint's name: it can't be undone, and its waiting deliveries are
// cancelled. Its history stays.
function DeleteEndpoint({ endpoint }: { endpoint: Endpoint }) {
  const router = useRouter();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const name = endpointName(endpoint);

  async function run() {
    setBusy(true);
    try {
      const { cancelled_deliveries } = await apiRequest<{ cancelled_deliveries: number }>(
        "DELETE",
        `/api/endpoints/${endpoint.id}`,
      );
      toast(
        cancelled_deliveries > 0
          ? `${name} deleted, and ${cancelled_deliveries.toLocaleString("en")} waiting ${cancelled_deliveries === 1 ? "delivery" : "deliveries"} cancelled`
          : `${name} deleted`,
      );
      router.push("/endpoints");
      router.refresh();
    } catch (err) {
      toast(err instanceof RequestError ? err.message : "That didn't work. Try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={() => setTyped("")}>
      <DialogTrigger asChild>
        <Button variant="danger">
          <Trash2 aria-hidden />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Delete ${name}?`}
        description="This can't be undone. Nothing more is sent to it, and its waiting deliveries are cancelled. Its delivery history stays."
      >
        <Field label={`Type ${name} to confirm`}>
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant="danger" onClick={run} disabled={typed !== name || busy}>
            {busy ? "Deleting…" : "Delete endpoint"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
