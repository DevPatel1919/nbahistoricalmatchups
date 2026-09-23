import { useEffect, useRef, useState } from "react";

interface Props {
  value: number; // 0..1
  durationMs?: number;
}

/** Counts up to a win-probability percentage once on mount/value change; skips the animation under prefers-reduced-motion. */
export default function CountUpPercent({ value, durationMs = 700 }: Props) {
  const target = Math.round(value * 1000) / 10; // one decimal place
  const [display, setDisplay] = useState(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const from = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round((from + (target - from) * eased) * 10) / 10);
      if (progress < 1) {
        frame.current = requestAnimationFrame(tick);
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return <span className="tabular">{display.toFixed(1)}%</span>;
}
