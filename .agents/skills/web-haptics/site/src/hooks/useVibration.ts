import { useRef, useEffect } from "react";

const BASE_ROTATION = -3;
const MAX_DRIFT = 20;
const MAX_ROTATION_OFFSET = 2;
const DRIFT_SPEED = 0.8;
const LERP_FACTOR = 0.15;
const VIBRATION_JITTER = 1.5;
const ROTATION_JITTER = 0.5;

export function useVibration(shaking: boolean) {
  const elRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef({ x: 0, y: 0, r: 0 });
  const currentRef = useRef({ x: 0, y: 0, r: 0 });

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    if (!shaking) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Keep the current drifted position, just apply without jitter
      const current = currentRef.current;
      el.style.transform = `rotate(${BASE_ROTATION + current.r}deg) translate(${current.x}px, ${current.y}px)`;
      return;
    }

    const loop = () => {
      const target = targetRef.current;
      const current = currentRef.current;

      target.x += (Math.random() - 0.5) * DRIFT_SPEED * 2;
      target.y += (Math.random() - 0.5) * DRIFT_SPEED * 2;
      target.r += (Math.random() - 0.5) * DRIFT_SPEED;

      target.x = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, target.x));
      target.y = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, target.y));
      target.r = Math.max(
        -MAX_ROTATION_OFFSET,
        Math.min(MAX_ROTATION_OFFSET, target.r),
      );

      current.x += (target.x - current.x) * LERP_FACTOR;
      current.y += (target.y - current.y) * LERP_FACTOR;
      current.r += (target.r - current.r) * LERP_FACTOR;

      const jitterX = (Math.random() - 0.5) * VIBRATION_JITTER;
      const jitterY = (Math.random() - 0.5) * VIBRATION_JITTER;
      const jitterR = (Math.random() - 0.5) * ROTATION_JITTER;

      const finalX = current.x + jitterX;
      const finalY = current.y + jitterY;
      const finalR = BASE_ROTATION + current.r + jitterR;

      el.style.transform = `rotate(${finalR}deg) translate(${finalX}px, ${finalY}px)`;

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [shaking]);

  return elRef;
}
