"use client";

import { Check, X } from "lucide-react";
import { Toast as RadixToast } from "radix-ui";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

// useToast() gives a function that shows a short confirmation in the corner:
//   const toast = useToast(); toast("Redelivered 37 deliveries");
const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

// Holds the toasts on screen. It wraps the whole app (in layout.tsx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((list) => [...list, { id, message }]);
  }, []);

  const remove = (id: number) => setToasts((list) => list.filter((toast) => toast.id !== id));

  return (
    <ToastContext value={show}>
      <RadixToast.Provider duration={5000} swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            onOpenChange={(open) => open || remove(toast.id)}
            className="flex items-center gap-2.5 rounded-inset border border-line-2 bg-card-3 px-4 py-3 text-[13.5px] shadow-card"
          >
            <Check aria-hidden className="size-4 shrink-0 text-ok" />
            <RadixToast.Title className="min-w-0 flex-1">{toast.message}</RadixToast.Title>
            <RadixToast.Close
              aria-label="Dismiss"
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-fg-2 hover:bg-hover"
            >
              <X aria-hidden className="size-3.5" />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext>
  );
}
