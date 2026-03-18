import React from "react";

export const useClickOutside = <T extends HTMLElement = HTMLElement>(
  handler: () => void,
) => {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [handler]);
  return { ref };
};
