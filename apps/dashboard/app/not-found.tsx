import { SearchX } from "lucide-react";
import Link from "next/link";
import { Problem } from "@/components/Problem";
import { Button } from "@/components/ui/Button";

// An address that isn't a page at all, like /endpoint (no s).
export default function NotFound() {
  return (
    <main className="p-5">
      <Problem
        icon={SearchX}
        title="There's no page here"
        actions={
          <Button variant="primary" asChild>
            <Link href="/">Go to Overview</Link>
          </Button>
        }
      >
        Check the address for a typo, or start again from the Overview.
      </Problem>
    </main>
  );
}
