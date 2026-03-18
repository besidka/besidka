import { useId } from "react";
import styles from "./styles.module.scss";

import { LayoutGroup, motion } from "motion/react";
import { useHaptics } from "../../hooks/useHaptics";

export const ToggleGroup = ({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) => {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div
        className={styles.group}
        style={{
          pointerEvents: disabled ? "none" : "auto",
        }}
      >
        {children}
      </div>
    </LayoutGroup>
  );
};

export const Toggle = ({
  children,
  active,
  ...props
}: {
  children: React.ReactNode;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const { trigger } = useHaptics();

  return (
    <button
      className={styles.toggle}
      {...props}
      data-active={active}
      onClick={(e) => {
        if (active) {
          e.preventDefault();
          return;
        }
        trigger();
        props.onClick?.(e);
      }}
    >
      {active && (
        <motion.span
          layoutId="toggle-indicator"
          className={styles.indicator}
          transition={{
            duration: 0.1,
          }}
        />
      )}
      <span className={styles.content}>{children}</span>
    </button>
  );
};
