import { useEffect, useRef } from 'react';

interface FireworksBurstProps {
  /** 1–2 = a modest celebration, 3 = the finale barrage. */
  intensity: 1 | 2 | 3;
  /** Called once the show is over (or immediately after the reduced-motion glow). */
  onDone: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

/** Bursts / duration per intensity — escalating on purpose. The finale is a
 * full ten-second barrage (owner-specified). */
const SHOW: Record<1 | 2 | 3, { bursts: number; durationMs: number }> = {
  1: { bursts: 3, durationMs: 2200 },
  2: { bursts: 6, durationMs: 3200 },
  3: { bursts: 30, durationMs: 10000 },
};

function themeColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  const tokens = ['--accent', '--accent-strong', '--accent-2', '--ok'];
  const colors = tokens
    .map((t) => style.getPropertyValue(t).trim())
    .filter((c) => c !== '');
  colors.push('#ffffff');
  return colors;
}

/**
 * A self-contained canvas fireworks show for a cracked Pipey clue — no
 * libraries (the renderer is offline + CSP-locked), tinted to the theme
 * accents, pointer-transparent so it never blocks anything. Respects
 * prefers-reduced-motion with a brief glow instead of particle motion.
 */
export function FireworksBurst({ intensity, onDone }: FireworksBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      onDoneRef.current();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const w = window.innerWidth;
    const h = window.innerHeight;

    const colors = themeColors();
    const { bursts, durationMs } = SHOW[intensity];
    const particles: Particle[] = [];
    const start = performance.now();

    const spawnBurst = () => {
      const cx = w * (0.15 + Math.random() * 0.7);
      const cy = h * (0.15 + Math.random() * 0.4);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const count = 46 + Math.floor(Math.random() * 30);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 1.5 + Math.random() * 4.5;
        const maxLife = 50 + Math.random() * 40;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: maxLife,
          maxLife,
          // A splash of white sparkle inside every burst.
          color: Math.random() < 0.2 ? '#ffffff' : color,
          size: 1.5 + Math.random() * 1.5,
        });
      }
    };

    // Stagger the bursts across the first ~70% of the show.
    const burstTimes = Array.from({ length: bursts }, (_, i) =>
      i === 0 ? 0 : (durationMs * 0.7 * i) / bursts + Math.random() * 120,
    );
    let nextBurst = 0;
    let raf = 0;
    let finished = false;

    const frame = (now: number) => {
      const elapsed = now - start;
      while (nextBurst < burstTimes.length && elapsed >= burstTimes[nextBurst]) {
        spawnBurst();
        nextBurst++;
      }

      ctx.clearRect(0, 0, w, h);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + 0.055; // drag + gravity
        p.life -= 1;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      if (nextBurst >= burstTimes.length && particles.length === 0) {
        if (!finished) {
          finished = true;
          onDoneRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, [intensity, reducedMotion]);

  if (reducedMotion) {
    return <div className="egg-glow" onAnimationEnd={() => onDoneRef.current()} />;
  }
  return <canvas ref={canvasRef} className="fireworks-canvas" aria-hidden="true" />;
}
