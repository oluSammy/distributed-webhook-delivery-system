"use client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// useToast is a hook, so it needs a client component.
export function ToastDemo() {
  const toast = useToast();
  return <Button onClick={() => toast("Redelivered 37 deliveries")}>Show a toast</Button>;
}
