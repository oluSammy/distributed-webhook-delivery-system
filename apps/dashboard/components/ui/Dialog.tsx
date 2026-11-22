import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";

// Radix's dialog with the design's look. Radix keeps keyboard focus inside while it's open, closes
// it on Esc or a click outside, and puts focus back on the button that opened it. Usage:
//   <Dialog>
//     <DialogTrigger asChild><Button>Pause</Button></DialogTrigger>
//     <DialogContent title="Pause CRM sync?">…<DialogClose asChild><Button>Cancel</Button></DialogClose></DialogContent>
//   </Dialog>
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  title,
  description,
  locked = false,
  children,
}: {
  title: string;
  description?: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <RadixDialog.Content
        // Radix links the description itself. Without one, say so, or Radix warns in the console.
        {...(description ? {} : { "aria-describedby": undefined })}
        onEscapeKeyDown={locked ? (event) => event.preventDefault() : undefined}
        onInteractOutside={locked ? (event) => event.preventDefault() : undefined}
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-40px)] w-[calc(100vw-32px)] max-w-130 -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[22px] border border-line-2 bg-card p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-start justify-between gap-3">
          <RadixDialog.Title className="text-[17px] font-semibold">{title}</RadixDialog.Title>
          {!locked && (
            <RadixDialog.Close
              aria-label="Close"
              className="-mt-1 -mr-1 inline-flex size-[30px] cursor-pointer items-center justify-center rounded-full text-fg-2 hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="size-4" />
            </RadixDialog.Close>
          )}
        </div>
        {description && (
          <RadixDialog.Description className="text-fg-2">{description}</RadixDialog.Description>
        )}
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
