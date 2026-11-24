"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Input } from "@/components/ui/Input";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The top bar's search: paste an endpoint, delivery or event id, press Enter, and go to it.
// /find/<id> works out which of the three it is.
export function FindById() {
  const router = useRouter();
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = String(new FormData(form).get("id")).trim();
    if (!UUID.test(id)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    form.reset();
    router.push(`/find/${id.toLowerCase()}`);
  }

  return (
    <search>
      <form onSubmit={submit} className="relative w-64 max-w-full">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
        />
        <Input
          name="id"
          aria-label="Find an endpoint, delivery or event by its id"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? "find-hint" : undefined}
          onChange={() => setInvalid(false)}
          placeholder="Find by id"
          autoComplete="off"
          spellCheck={false}
          className="pl-9 font-mono text-[12.5px]"
        />
        {invalid && (
          <p
            id="find-hint"
            role="alert"
            className="absolute top-full left-0 z-10 mt-1 rounded-lg bg-card px-2.5 py-1.5 text-[12.5px] text-dead shadow-card"
          >
            Paste a full id, like 01a2039b-…-61d4.
          </p>
        )}
      </form>
    </search>
  );
}
