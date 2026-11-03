"use client";
import { useState, type SetStateAction } from "react";
import { useWorkspace } from "@/components/providers";
// Server-owned selections/drafts expire on remote changes, sign-out and offline/hidden transitions.
export function useLiveSelection<T>(initial: T) {
  const { privacyEpoch, canFetch } = useWorkspace();
  const [state, setState] = useState({ epoch: privacyEpoch, value: initial });
  if (state.epoch !== privacyEpoch || (!canFetch && state.value !== initial))
    setState({ epoch: privacyEpoch, value: initial });
  const set = (value: SetStateAction<T>) =>
    setState((s) => ({
      epoch: privacyEpoch,
      value:
        typeof value === "function"
          ? (value as (previous: T) => T)(s.value)
          : value,
    }));
  return [
    state.epoch === privacyEpoch && canFetch ? state.value : initial,
    set,
  ] as const;
}
