import styles from "./styles.module.scss";

import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
} from "react";

export type EmojiOption = { emoji: string; canFlip: boolean };

type ParticlesContextValue = {
  create: (
    x: number,
    y: number,
    emojis: EmojiOption[],
    duration?: number,
    gx?: number,
    gy?: number,
  ) => void;
};

interface Particle {
  x: number;
  y: number;
  xv: number;
  yv: number;
  a: number;
  s: number;
  opacity: number;
  life: number;
  maxLife: number;
  emoji: string;
  flipH: boolean;
  fontSize: number;
  radius: number;
  gx: number;
  gy: number;
}

const ParticlesContext = createContext<ParticlesContextValue | null>(null);

export const useParticles = () => {
  const ctx = useContext(ParticlesContext);
  if (!ctx) {
    throw new Error("useParticles must be used within a ParticlesProvider");
  }
  return ctx;
};

const MAX_ACTIVE = 500;
const ANIM_FRAMES = 120;
const MAX_DPR = 2;

// --- Emoji cache ---

const emojiCache = new Map<string, HTMLCanvasElement>();

function getEmojiCanvas(emoji: string): HTMLCanvasElement {
  const existing = emojiCache.get(emoji);
  if (existing) return existing;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const CANONICAL_PX = 64;
  const fontSize = Math.ceil(CANONICAL_PX * dpr);
  // Pad canvas so glyphs that overflow the em-square aren't clipped
  const size = Math.ceil(fontSize * 1.5);

  const offscreen = document.createElement("canvas");
  offscreen.width = size;
  offscreen.height = size;

  const ctx = offscreen.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${fontSize}px serif`;
  ctx.fillText(emoji, size / 2, size / 2);

  emojiCache.set(emoji, offscreen);
  return offscreen;
}

// --- Physics ---

function updateParticle(p: Particle): boolean {
  p.a += p.xv * 0.5;
  p.yv *= 0.9;
  p.y += p.yv;
  p.xv *= 0.98;
  p.x += p.xv;
  p.s += (1 - p.s) * 0.3;
  p.xv += p.gx * 0.1;
  p.yv += (p.gy + p.yv) * 0.1;

  p.radius = p.fontSize * p.s * 0.5;

  p.life--;
  const lifeRatio = p.life / p.maxLife;
  if (lifeRatio < 0.25) {
    p.opacity = lifeRatio / 0.25;
  }

  return p.life > 0 && p.opacity > 0.01;
}

function resolveCollisions(particles: Particle[]) {
  const n = particles.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = particles[i];
      const b = particles[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      const minDist = a.radius + b.radius;

      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        // Push apart
        const overlap = minDist - dist;
        const sep = overlap * 0.5;
        a.x -= nx * sep;
        a.y -= ny * sep;
        b.x += nx * sep;
        b.y += ny * sep;

        // Elastic velocity exchange along normal
        const dvx = a.xv - b.xv;
        const dvy = a.yv - b.yv;
        const dvDotN = dvx * nx + dvy * ny;

        if (dvDotN > 0) {
          const restitution = 0.5;
          const impulse = dvDotN * restitution;
          a.xv -= impulse * nx;
          a.yv -= impulse * ny;
          b.xv += impulse * nx;
          b.yv += impulse * ny;
        }
      }
    }
  }
}

// --- Canvas sizing ---

function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const targetW = Math.round(width * dpr);
  const targetH = Math.round(height * dpr);

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
}

// --- Spawning ---

function spawnBurst(
  particles: Particle[],
  x: number,
  y: number,
  emojis: EmojiOption[],
  gx: number,
  gy: number,
) {
  const amount = 4;
  if (particles.length + amount > MAX_ACTIVE) return;

  for (let i = 0; i < amount; i++) {
    const xv = Math.random() * 16 - 8;
    const yv =
      (i === 0 ? 4 : i === 1 ? 8 : i === 2 ? 8 : 0) *
      (0.25 + Math.random() * 0.25);

    const pick = emojis[Math.floor(Math.random() * emojis.length)];

    particles.push({
      x,
      y,
      xv,
      yv,
      a: 0,
      s: 0.2,
      opacity: 1,
      life: ANIM_FRAMES,
      maxLife: ANIM_FRAMES,
      emoji: pick?.emoji || "\u2728",
      flipH: pick?.canFlip ? Math.random() < 0.5 : false,
      fontSize: 20 + Math.ceil(Math.random() * 40),
      radius: 0,
      gx,
      gy,
    });
  }
}

// --- Component ---

export const ParticlesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const startLoop = useCallback(() => {
    if (rafIdRef.current !== null) return; // already running

    const canvas = canvasRef.current;
    if (!canvas || !ctxRef.current) return;
    const ctx = ctxRef.current;

    function frame() {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const particles = particlesRef.current;

      // Update physics, cull dead particles (swap-and-pop)
      for (let i = particles.length - 1; i >= 0; i--) {
        if (!updateParticle(particles[i])) {
          particles[i] = particles[particles.length - 1];
          particles.pop();
        }
      }

      // Stop loop when idle
      if (particles.length === 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas!.width, canvas!.height);
        rafIdRef.current = null;
        return;
      }

      resolveCollisions(particles);

      // Clear
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);

      // Draw particles batched by opacity: full-opacity first, then fading
      ctx.globalAlpha = 1;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const isFading = p.opacity < 1;

          if (pass === 0 && isFading) continue;
          if (pass === 1 && !isFading) continue;

          if (pass === 1) {
            ctx.globalAlpha = p.opacity;
          }

          const emojiImg = getEmojiCanvas(p.emoji);
          const drawSize = p.fontSize * p.s * 1.5;
          const halfSize = drawSize / 2;

          // Compute transform matrix directly: translate(x,y) * rotate(a) * scale(dpr)
          // Avoids save()/restore() which is slow on iOS Safari
          const rad = (p.a * Math.PI) / 180;
          const cos = Math.cos(rad) * dpr;
          const sin = Math.sin(rad) * dpr;
          const fx = p.flipH ? -1 : 1;
          ctx.setTransform(cos * fx, sin * fx, -sin, cos, p.x * dpr, p.y * dpr);

          ctx.drawImage(emojiImg, -halfSize, -halfSize, drawSize, drawSize);
        }
      }

      rafIdRef.current = requestAnimationFrame(frame);
    }

    rafIdRef.current = requestAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    ctxRef.current = canvas.getContext("2d") as CanvasRenderingContext2D;
    resizeCanvas(canvas);

    const onResize = () => resizeCanvas(canvas);
    window.addEventListener("resize", onResize);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const create = useCallback(
    (
      x: number,
      y: number,
      emojis: EmojiOption[] = [{ emoji: "\u2728", canFlip: false }, { emoji: "\uD83D\uDD25", canFlip: false }],
      duration?: number,
      gx: number = 0,
      gy: number = -1.5,
    ) => {
      const particles = particlesRef.current;
      spawnBurst(particles, x, y, emojis, gx, gy);
      startLoop();

      if (duration && duration > 0) {
        const interval = 150;
        const count = Math.floor(duration / interval);
        for (let i = 1; i <= count; i++) {
          setTimeout(() => {
            spawnBurst(particles, x, y, emojis, gx, gy);
            startLoop();
          }, i * interval);
        }
      }
    },
    [startLoop],
  );

  return (
    <ParticlesContext.Provider value={{ create }}>
      {children}
      <canvas ref={canvasRef} className={styles.particles} />
    </ParticlesContext.Provider>
  );
};
