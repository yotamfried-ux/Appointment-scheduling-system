"use client";

// Minimal toast system on Radix Toast. We deliberately do not use `sonner`: it injects a <style>
// element at runtime without a CSP nonce, which our CSP (docs/05 §5.5) correctly blocks.
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { Toast } from "radix-ui";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type Variant = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: Variant;
  duration: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function toast(title: string, opts: { description?: string; variant?: Variant; duration?: number } = {}) {
  items = [...items, { id: nextId++, title, description: opts.description, variant: opts.variant ?? "info", duration: opts.duration ?? 5000 }];
  emit();
}
const dismiss = (id: number) => {
  items = items.filter((i) => i.id !== id);
  emit();
};

const STYLES: Record<Variant, { box: string; icon: React.ElementType }> = {
  success: { box: "border-success/40 bg-success-soft text-success-soft-foreground", icon: CheckCircle2 },
  error: { box: "border-destructive/40 bg-destructive-soft text-destructive-soft-foreground", icon: XCircle },
  warning: { box: "border-warning/40 bg-warning-soft text-warning-soft-foreground", icon: TriangleAlert },
  info: { box: "border-border bg-card text-card-foreground", icon: Info },
};

const EMPTY: ToastItem[] = [];

export function Toaster({ closeLabel = "סגירה" }: { closeLabel?: string }) {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  return (
    <Toast.Provider swipeDirection="up" label="התראות">
      {list.map((t) => {
        const { box, icon: Icon } = STYLES[t.variant];
        return (
          <Toast.Root
            key={t.id}
            duration={t.duration}
            onOpenChange={(open) => !open && dismiss(t.id)}
            type={t.variant === "error" ? "foreground" : "background"}
            className={cn(
              "pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-4 shadow-pop",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-4",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[swipe=end]:animate-out",
              box,
            )}
          >
            <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <Toast.Title className="text-sm font-semibold">{t.title}</Toast.Title>
              {t.description ? <Toast.Description className="mt-0.5 text-sm opacity-90">{t.description}</Toast.Description> : null}
            </div>
            <Toast.Close aria-label={closeLabel} className="tap -m-2 inline-flex items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100">
              <X className="size-4" aria-hidden />
            </Toast.Close>
          </Toast.Root>
        );
      })}
      <Toast.Viewport className="pt-safe fixed inset-x-0 top-0 z-[100] mx-auto flex w-full max-w-md flex-col gap-2 p-4 outline-none" />
    </Toast.Provider>
  );
}
