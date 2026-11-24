import { SearchX } from "lucide-react";
import Link from "next/link";
import { Problem } from "@/components/Problem";
import { Button } from "@/components/ui/Button";

// When a page calls notFound(): apiGet does on a 404, which is also what the API answers for
// another workspace's endpoint, delivery or event. Shown inside the sidebar layout.
export default function NotFound() {
  return (
    <Problem
      icon={SearchX}
      title="Not found"
      actions={
        <Button variant="primary" asChild>
          <Link href="/">Go to Overview</Link>
        </Button>
      }
    >
      It may have been deleted, or the address is wrong. Or it's in another workspace: if you're in
      more than one, switch at the top of the sidebar.
    </Problem>
  );
}
