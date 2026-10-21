"use client";

import { useEffect, useState } from "react";

/** Counts down while `active`. Resets whenever `resetKey` changes. Prototype of the slot hold (BKG-03). */
export function useHoldTimer(active: boolean, seconds: number, resetKey: string, onExpire: () => void) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restart the countdown when the held slot changes
    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          onExpire();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // onExpire intentionally omitted: it is a stable dispatch wrapper in the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, seconds, resetKey]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  return { remaining, label: `${mm}:${ss}` };
}
