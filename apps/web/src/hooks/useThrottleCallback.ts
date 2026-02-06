import { useCallback, useRef } from 'react';

export function useThrottleCallback<T extends (...args: any[]) => void>(
  callback: T,
  delayMs: number
) {
  const lastCalled = useRef(0);

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastCalled.current >= delayMs) {
        lastCalled.current = now;
        callback(...args);
      }
    },
    [callback, delayMs]
  );
}
