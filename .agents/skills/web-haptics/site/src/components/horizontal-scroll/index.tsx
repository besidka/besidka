import { useEffect, useRef, forwardRef } from "react";
import styles from "./styles.module.scss";

type HorizontalScrollProps = {
  children: React.ReactNode;
  style?: React.CSSProperties;
  onHover?: (e: Event) => void;
};

export const HorizontalScroll = forwardRef<
  HTMLDivElement,
  HorizontalScrollProps
>(({ children, style, onHover: onHoverCallback }, ref) => {
  const fallbackRef = useRef<HTMLDivElement>(null);

  // Actual ref instance — parent ref or fallback
  const elementRef = (ref as React.RefObject<HTMLDivElement>) ?? fallbackRef;

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const onHover = (e: Event) => {
      onHoverCallback?.(e);
    };

    const onScrollWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    el.addEventListener("wheel", onScrollWheel, { passive: false });
    el.addEventListener("mouseenter", onHover);

    return () => {
      el.removeEventListener("wheel", onScrollWheel);
      el.removeEventListener("mouseenter", onHover);
    };
  }, [elementRef, onHoverCallback]);

  return (
    <div className={styles.container} style={style}>
      <div className={styles.scrollarea} ref={elementRef}>
        {children}
      </div>
    </div>
  );
});

HorizontalScroll.displayName = "HorizontalScroll";
