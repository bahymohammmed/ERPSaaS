'use client';

import { useReducedMotion } from '@mantine/hooks';
import { useEffect, useState } from 'react';

/** Animates a number from 0 to `target` (ease-out), or jumps straight there when motion is reduced. */
export const useCountUp = (target: number | null | undefined, duration = 900): number | null => {
  const reduce = useReducedMotion();
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (target === null || target === undefined) return;
    if (reduce) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(target * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduce]);
  return value;
};
