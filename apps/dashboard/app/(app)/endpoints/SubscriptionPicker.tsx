"use client";

import { CircleAlert, Plus } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Tag } from "@/components/ui/Tag";
import type { EventType } from "@/lib/event-types";

// The API's limit, and its rule for a pattern: *, an event type, or a prefix ending in .*.
const MAX_SUBSCRIPTIONS = 50;
const PATTERN = /^(\*|[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?)$/;

// Which event types an endpoint gets: a chip for "*" (everything), and patterns typed and added,
// each shown as a chip; pressed means subscribed, and a click removes a typed one. Under the chips:
// what each pattern matches among the registered types. The chosen patterns go in a hidden
// "subscriptions" field, which readEndpointForm reads.
export function SubscriptionPicker({ initial, error }: { initial: string[]; error?: string }) {
  const id = useId();
  const [patterns, setPatterns] = useState(initial);
  // The registered types, only to say what each pattern matches. If they can't be read, that box
  // is left out; everything else works.
  const [types, setTypes] = useState<string[] | "loading" | "failed">("loading");
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);

  // Asked for when the form opens, not with the page: only someone adding or editing needs them.
  useEffect(() => {
    fetch("/api/event-types")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { event_types: EventType[] } | null) =>
        setTypes(body ? body.event_types.map((type) => type.name) : "failed"),
      )
      .catch(() => setTypes("failed"));
  }, []);

  const suggestions = ["*"];
  // Patterns chosen that aren't suggested (typed, or a type since removed) stay as chips too.
  const chips = [...suggestions, ...patterns.filter((p) => !suggestions.includes(p))];
  const full = patterns.length >= MAX_SUBSCRIPTIONS;

  function toggle(pattern: string) {
    if (patterns.includes(pattern)) {
      setPatterns(patterns.filter((p) => p !== pattern));
    } else if (!full) {
      setPatterns([...patterns, pattern]);
    }
  }

  function addTyped() {
    const pattern = typed.trim();
    if (!pattern) {
      return;
    }
    if (!PATTERN.test(pattern)) {
      setTypedError("Use *, an event type like order.paid, or a prefix like order.*");
      return;
    }
    if (!patterns.includes(pattern)) {
      setPatterns([...patterns, pattern]);
    }
    setTyped("");
    setTypedError(null);
  }

  // Enter adds the pattern instead of submitting the whole form.
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTyped();
    }
  }

  const message = typedError ?? error;
  return (
    <fieldset aria-describedby={`${id}-help`}>
      <legend className="mb-1.5 block text-[13px] font-medium">Subscriptions</legend>
      <input type="hidden" name="subscriptions" value={patterns.join(",")} />
      <div className="flex flex-wrap gap-2">
        {chips.map((pattern) => (
          <Chip
            key={pattern}
            pressed={patterns.includes(pattern)}
            disabled={full && !patterns.includes(pattern)}
            onClick={() => toggle(pattern)}
            className="font-mono text-[12.5px] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {pattern === "*" ? "* everything" : pattern}
          </Chip>
        ))}
      </div>

      <div className="mt-2.5 flex gap-2">
        <Input
          aria-label="Add a pattern"
          aria-invalid={typedError ? true : undefined}
          aria-describedby={message ? `${id}-message` : undefined}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setTypedError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="invoice.* or order.shipped"
          disabled={full}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <Button onClick={addTyped} disabled={full || !typed.trim()}>
          <Plus aria-hidden />
          Add
        </Button>
      </div>

      {Array.isArray(types) && <Matches patterns={patterns} types={types} />}

      {message && (
        <p
          id={`${id}-message`}
          className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-dead"
        >
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {message}
        </p>
      )}
      <p id={`${id}-help`} className="mt-1.5 text-[12.5px] text-fg-3">
        Everything, or type an exact type like <code className="font-mono">order.paid</code> or a
        prefix like <code className="font-mono">invoice.*</code>. {patterns.length} of{" "}
        {MAX_SUBSCRIPTIONS}.
      </p>
    </fieldset>
  );
}

// For each wildcard chosen, the registered types it matches today, and a warning for a pattern
// that matches none. An exact registered type needs no line: it matches itself.
function Matches({ patterns, types }: { patterns: string[]; types: string[] }) {
  const lines = patterns
    .filter((pattern) => pattern.endsWith("*") || !types.includes(pattern))
    .map((pattern) => ({ pattern, matched: types.filter((type) => matches(pattern, type)) }));
  if (lines.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2.5 flex flex-col gap-1.5 rounded-inset border border-line bg-card-2 px-3 py-2.5 text-[12.5px] text-fg-2">
      {lines.map(({ pattern, matched }) => (
        <li key={pattern} className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-fg">{pattern}</span>
          {pattern === "*" ? (
            <span>matches every type, including ones registered later</span>
          ) : matched.length === 0 ? (
            <span>matches no registered type yet</span>
          ) : (
            <>
              matches
              {matched.map((type) => (
                <Tag key={type}>{type}</Tag>
              ))}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

// The same rule as the database's event_type_matches: * matches everything, a type matches itself,
// and "order.*" matches every type starting "order." (not "orderx.created").
function matches(pattern: string, type: string): boolean {
  return (
    pattern === "*" ||
    pattern === type ||
    (pattern.endsWith(".*") && type.startsWith(pattern.slice(0, -1)))
  );
}
