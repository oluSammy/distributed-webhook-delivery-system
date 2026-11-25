import { Lock } from "lucide-react";
import { Banner } from "@/components/ui/Banner";

// Above an owner-only section, for members: what they see is read-only, and why.
export function OwnersOnly({ tenant }: { tenant: string }) {
  return (
    <Banner tone="info" icon={Lock}>
      <strong>Only owners can change this.</strong> Ask an owner of {tenant} to do it, or to make
      you an owner.
    </Banner>
  );
}
