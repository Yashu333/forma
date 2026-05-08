"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import { createPortal } from "react-dom";

const COLORS = [
  "#7C6EF8", "#F97316", "#34D399", "#F59E0B",
  "#60A5FA", "#F472B6", "#A78BFA", "#FBBF24",
  "#818CF8", "#4ADE80", "#FB923C", "#E879F9",
];
const PIECE_COUNT = 140;
const DURATION = 3200;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  wobble: number;
  wobbleSpeed: number;
  color: string;
  width: number;
  height: number;
  shape: "rect" | "circle";
}

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function createPiece(canvasWidth: number): Piece {
  const angle = randomBetween(-Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8);
  const speed = randomBetween(10, 28);
  return {
    x: randomBetween(canvasWidth * 0.2, canvasWidth * 0.8),
    y: randomBetween(-180, -40),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rotation: randomBetween(0, Math.PI * 2),
    rotationSpeed: randomBetween(-0.25, 0.25),
    wobble: randomBetween(0, Math.PI * 2),
    wobbleSpeed: randomBetween(0.03, 0.08),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    width: randomBetween(7, 14),
    height: randomBetween(4, 9),
    shape: Math.random() > 0.55 ? "circle" : "rect",
  };
}

export interface ConfettiHandle {
  fire: () => void;
}

const ConfettiCelebration = forwardRef<ConfettiHandle>((_, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }, [mounted]);

  useImperativeHandle(ref, () => ({
    fire() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      cancelAnimationFrame(rafRef.current);

      const pieces = Array.from({ length: PIECE_COUNT }, () => createPiece(canvas.width));
      const startTime = performance.now();

      function tick(now: number) {
        if (!canvas || !ctx) return;
        const elapsed = now - startTime;
        const progress = elapsed / DURATION;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        pieces.forEach(p => {
          p.vy += 0.38;
          p.vx += Math.sin(p.wobble) * 0.06;
          p.wobble += p.wobbleSpeed;
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.rotationSpeed;

          const opacity = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;

          ctx.save();
          ctx.globalAlpha = Math.max(0, opacity);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;

          if (p.shape === "circle") {
            ctx.beginPath();
            ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
          }
          ctx.restore();
        });

        if (elapsed < DURATION) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    },
  }));

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }}
    />,
    document.body
  );
});

ConfettiCelebration.displayName = "ConfettiCelebration";
export default ConfettiCelebration;
