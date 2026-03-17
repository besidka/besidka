import { useState } from "react";

import styles from "./styles.module.scss";
import { AutoResize } from "../auto-resizer";
import { TextMorph } from "torph/react";
import { useHaptics } from "../../hooks/useHaptics";

export const CodeBlock = ({
  code,
  children,
}: {
  code: string;
  children?: React.ReactNode;
}) => {
  const { trigger } = useHaptics();

  const [isCopied, setIsCopied] = useState(false);

  return (
    <div className={styles.container}>
      <button
        className={styles.copy}
        onClick={() => {
          if (code) {
            setIsCopied(true);
            navigator.clipboard.writeText(code.toString());
            trigger();
            setTimeout(() => {
              setIsCopied(false);
            }, 2000);
          }
        }}
      >
        <TextMorph>{isCopied ? "Copied" : "Copy"}</TextMorph>
      </button>
      <pre>
        <AutoResize>{children ?? code}</AutoResize>
      </pre>
    </div>
  );
};
