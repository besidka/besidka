const EMOJI = "🫨";
const BASE_SVG = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${EMOJI}</text></svg>`;

const FRAME_COUNT = 8;
const FRAME_INTERVAL = 80; // ms between favicon swaps

// pre-generate shake frames so we're not building strings at runtime
const frames: string[] = [];
for (let i = 0; i < FRAME_COUNT; i++) {
  const x = (Math.random() - 0.5) * 20;
  const y = (Math.random() - 0.5) * 20;
  frames.push(
    `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90' transform='translate(${x},${y})'>${EMOJI}</text></svg>`,
  );
}

let rafId: number | null = null;

export function shakeFavicon(duration = 300) {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) return;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }

  const start = performance.now();
  let lastSwap = 0;
  let frameIndex = 0;

  const loop = (time: number) => {
    const elapsed = time - start;

    if (elapsed >= duration) {
      link.href = BASE_SVG;
      rafId = null;
      return;
    }

    if (time - lastSwap >= FRAME_INTERVAL) {
      link.href = frames[frameIndex % FRAME_COUNT]!;
      frameIndex++;
      lastSwap = time;
    }

    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);
}
