import { useEffect, useRef, useState } from "react";

export const useAutoResize = ({
  property = "height",
}: {
  property?: "height" | "width" | "both";
}) => {
  // ref can be attached to any HTML element
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const [width, setWidth] = useState<number | "auto">("auto");

  useEffect(() => {
    if (ref.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        const observedHeight = entries[0].contentRect.height;
        const observedWidth = entries[0].contentRect.width;
        setHeight(observedHeight);
        setWidth(observedWidth);
      });

      resizeObserver.observe(ref.current);

      return () => {
        resizeObserver.disconnect();
      };
    }
  }, []);

  const heightValue = property === "height" ? height : "auto";
  const widthValue = property === "width" ? width : "auto";

  return {
    ref,
    height: heightValue,
    width: widthValue,
  };
};
