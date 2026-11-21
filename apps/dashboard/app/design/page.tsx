import {
  Ban,
  Bell,
  Check,
  CirclePause,
  CircleSlash,
  Clock,
  Gauge,
  OctagonX,
  Pause,
  Plus,
  PowerOff,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ShortId } from "@/components/ui/ShortId";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";
import { Tag } from "@/components/ui/Tag";
import { Timeline, TimelineGap, TimelineItem } from "@/components/ui/Timeline";
import { RangeDemo } from "./RangeDemo";
import { ToastDemo } from "./ToastDemo";

const payload = JSON.stringify(
  { order_id: "ord_7Hk2", amount: 4999, currency: "USD", paid: true, coupon: null },
  null,
  2,
);

const curl = `curl https://webhooks.olumorin.dev/api/events \\
  -H "Authorization: Bearer $WEBHOOKS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"order.paid","payload":{"order_id":"ord_7Hk2"}}'`;

const rows = [
  { id: "3f9d2a10-8b6e-7c41-a5f0-1d2e7b9c4e05", type: "order.paid", endpoint: "Billing service" },
  { id: "7c1e0b92-44aa-7f30-b2d1-0e9a5c3f6a18", type: "customer.updated", endpoint: "CRM sync" },
];

// Every component of the design system on one page, to check them in light and dark.
export default function DesignPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-5 p-5">
      <h1 className="text-[22px] font-semibold tracking-tight">Design system</h1>

      <Section title="Buttons">
        <Button variant="primary">
          <Plus aria-hidden />
          Create endpoint
        </Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Disabled</Button>
        <Button iconOnly aria-label="Notifications">
          <Bell aria-hidden />
        </Button>
        <Button size="sm">Small</Button>
        <Button size="lg" variant="primary">
          Large
        </Button>
        <Button asChild>
          <a href="/">A link that looks like a button</a>
        </Button>
      </Section>

      <Section title="State badges">
        <Badge tone="ok" icon={Check}>
          Succeeded
        </Badge>
        <Badge tone="fail" icon={RotateCw}>
          Failing
        </Badge>
        <Badge tone="dead" icon={OctagonX}>
          Dead
        </Badge>
        <Badge tone="pend" icon={Clock}>
          Pending
        </Badge>
        <Badge tone="pend" icon={Gauge}>
          Throttled
        </Badge>
        <Badge tone="pause" icon={Pause}>
          Paused
        </Badge>
        <Badge tone="dis" icon={Ban}>
          Disabled
        </Badge>
        <Badge tone="cancel" icon={CircleSlash}>
          Cancelled
        </Badge>
        <Badge tone="fail" icon={TriangleAlert}>
          Degraded
        </Badge>
        <Badge tone="ok" icon={Check}>
          Healthy
        </Badge>
        <Badge tone="neutral">4 unread</Badge>
      </Section>
      <Section title="Fields">
        <div className="grid w-full gap-3 sm:grid-cols-2">
          <Field label="Description" help="Up to 500 characters.">
            {(control) => <Input {...control} defaultValue="Orders webhook" />}
          </Field>
          <Field label="URL" error="Must start with https://">
            {(control) => (
              <Input {...control} className="font-mono" defaultValue="http://localhost:3000" />
            )}
          </Field>
        </div>
      </Section>

      <Section title="Segmented control, chips and tags">
        <RangeDemo />
        <Chip pressed count={4}>
          All
        </Chip>
        <Chip count={1}>Degraded</Chip>
        <Tag>order.*</Tag>
        <Tag>invoice.overdue</Tag>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="overview" className="w-full">
          <TabList label="Endpoint sections">
            <Tab value="overview">Overview</Tab>
            <Tab value="health">Health</Tab>
            <Tab value="settings">Settings</Tab>
          </TabList>
          <TabPanel value="overview">The endpoint's chart and recent deliveries.</TabPanel>
          <TabPanel value="health">Live limits and the circuit breaker.</TabPanel>
          <TabPanel value="settings">URL, subscriptions and limits.</TabPanel>
        </Tabs>
      </Section>
      <Section title="Banners">
        <div className="flex w-full flex-col gap-2.5">
          <Banner tone="pause" icon={CirclePause}>
            <strong>Delivery is paused for your account by the operator.</strong> Events are still
            accepted and their deliveries wait.
          </Banner>
          <Banner
            tone="dis"
            icon={PowerOff}
            action={
              <Button size="sm" asChild>
                <a href="/design/">View endpoint</a>
              </Button>
            }
          >
            <strong>CRM sync is disabled.</strong> The circuit breaker stopped sending at 13:58.
            Next test delivery at 14:12.
          </Banner>
        </div>
      </Section>

      <Section title="Loading">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-10 w-full" />
      </Section>

      <Section title="Dialog and toast">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Pause endpoint…</Button>
          </DialogTrigger>
          <DialogContent
            title="Pause CRM sync?"
            description="Nothing will be sent to this endpoint until you resume. New deliveries will wait."
          >
            <ul className="list-disc space-y-1 pl-5 text-fg-2">
              <li>Pausing doesn't use up any attempts or retry time.</li>
              <li>Deliveries being sent right now finish first.</li>
            </ul>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="primary">Pause endpoint</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
        <ToastDemo />
      </Section>
      <Section title="Table and ids">
        <div className="w-full">
          <Table label="Deliveries">
            <thead>
              <tr>
                <Th>Delivery</Th>
                <Th>Event type</Th>
                <Th>Endpoint</Th>
                <Th>State</Th>
                <Th align="right">Attempts</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <Td>
                    <ShortId id={row.id} label="delivery id" />
                  </Td>
                  <Td>
                    <Tag>{row.type}</Tag>
                  </Td>
                  <Td>{row.endpoint}</Td>
                  <Td>
                    {index === 0 ? (
                      <Badge tone="fail" icon={RotateCw}>
                        Failing
                      </Badge>
                    ) : (
                      <Badge tone="dead" icon={OctagonX}>
                        Dead
                      </Badge>
                    )}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {index === 0 ? 4 : 10}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Section>

      <Section title="Code">
        <div className="grid w-full gap-3">
          <CodeBlock code={payload} language="json" copyLabel="Copy payload" />
          <CodeBlock
            code="<html><body><h1>503 Service Unavailable</h1></body></html>"
            language="html"
            copyLabel="Copy response body"
          />
          <CodeBlock code={curl} language="bash" copyLabel="Copy command" />
          <CodeBlock code="Gateway timeout after 10 s" copyLabel="Copy error" />
        </div>
      </Section>

      <Section title="Timeline">
        <div className="w-full">
          <Timeline>
            <TimelineItem marker="3" tone="pend" upcoming>
              <span>
                <strong>Attempt 3</strong> <span className="text-fg-2">scheduled for 14:02:11</span>
              </span>
            </TimelineItem>
            <TimelineGap>waits up to 1 min</TimelineGap>
            <TimelineItem marker="2" tone="fail">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <strong>Attempt 2</strong>
                <Badge tone="fail">Failure</Badge>
                <span className="font-mono text-[12.5px]">503</span>
                <span className="text-fg-3 tabular-nums">620 ms</span>
              </div>
              <CodeBlock
                code="<html><body><h1>503 Service Unavailable</h1></body></html>"
                copyLabel="Copy response body"
              />
            </TimelineItem>
            <TimelineGap>retried 23 s later</TimelineGap>
            <TimelineItem marker="1" tone="fail" faded>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <strong>Attempt 1</strong>
                <Badge tone="fail">Failure · stale</Badge>
                <span className="font-mono text-[12.5px]">500</span>
                <span className="text-fg-3 tabular-nums">812 ms</span>
              </div>
            </TimelineItem>
          </Timeline>
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </Card>
  );
}
