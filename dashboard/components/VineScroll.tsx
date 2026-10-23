"use client";

import { useEffect, useRef, useState } from "react";

// A wavy vine that grows as you scroll. Click or drag it to jump. The native scroll bar is hidden in globals.css.
const D = Array.from({ length: 51 }, (_, i) => {
  const y = i * 20;
  const x = 23 + 9 * Math.sin(y / 62);
  return `${i ? "L" : "M"}${x.toFixed(1)},${y}`;
}).join(" ");
const LEAF_AT = [8, 19, 30, 41, 52, 63, 74, 85, 95];

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function VineScroll() {
  const [p, setP] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    const update = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setP(max > 0 ? clamp(el.scrollTop / max) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, []);

  const jump = (clientY: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    const el = document.documentElement;
    window.scrollTo({ top: clamp((clientY - r.top) / r.height) * (el.scrollHeight - el.clientHeight), behavior: "auto" });
  };

  return (
    <div
      ref={track}
      className="vine"
      aria-hidden="true"
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        jump(e.clientY);
      }}
      onPointerMove={(e) => drag.current && jump(e.clientY)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
    >
      <svg viewBox="0 0 46 1000" preserveAspectRatio="none">
        <path d={D} className="vine-ghost" />
        <path d={D} className="vine-grow" pathLength={1} style={{ strokeDashoffset: 1 - p }} />
      </svg>
      {LEAF_AT.map((y, i) => (
        <span key={y} className={`vleaf ${i % 2 ? "r" : "l"}${p * 100 >= y ? " on" : ""}`} style={{ top: `${y}%` }}>
          🍃
        </span>
      ))}
      <span className="vtip" style={{ top: `${p * 100}%` }}>🌱</span>
    </div>
  );
}
