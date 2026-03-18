import { motion, Transition } from "motion/react";

const transition: Transition = {
  duration: 0.2,
  ease: "easeInOut",
};

export const SoundIcon = ({ enabled }: { enabled: boolean }) => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M13 7L8 11H4V17H8L13 21V7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {enabled ? (
      <g>
        <motion.path
          d="M21.07 7C22.9447 8.87528 23.9979 11.4184 23.9979 14.07C23.9979 16.7216 22.9447 19.2647 21.07 21.14"
          stroke="currentColor"
          strokeWidth="1.5"
          animate={{
            pathLength: [0, 1],
          }}
          transition={{ ...transition, delay: 0.1 }}
        />
        <motion.path
          d="M17.54 10.53C18.4773 11.4676 19.0039 12.7392 19.0039 14.065C19.0039 15.3908 18.4773 16.6624 17.54 17.6"
          stroke="currentColor"
          strokeWidth="1.5"
          transition={transition}
          animate={{
            pathLength: [0, 1],
          }}
        />
      </g>
    ) : (
      <g>
        <motion.path
          key="lineA"
          d="M25 11L19 17"
          stroke="currentColor"
          strokeWidth="1.5"
          animate={{
            pathLength: [0, 1],
          }}
          transition={{ ...transition, delay: 0.1 }}
        />
        <motion.path
          key="lineB"
          d="M19 11L25 17"
          stroke="currentColor"
          strokeWidth="1.5"
          animate={{
            pathLength: [0, 1],
          }}
          transition={transition}
        />
      </g>
    )}
  </svg>
);
