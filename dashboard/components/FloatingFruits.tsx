// Soft, translucent fruit and vegetables drifting behind the glass cards. Purely decorative.
const ITEMS: { e: string; left?: string; right?: string; top: string; size: number; d: number; delay: number; r0: number; r1: number }[] = [
  { e: "🍎", left: "3%", top: "14%", size: 64, d: 11, delay: 0, r0: -8, r1: 6 },
  { e: "🥕", right: "9%", top: "20%", size: 58, d: 13, delay: 1.5, r0: 10, r1: -6 },
  { e: "🥑", left: "22%", top: "6%", size: 52, d: 12, delay: 0.8, r0: -4, r1: 9 },
  { e: "🍊", right: "30%", top: "9%", size: 50, d: 10, delay: 2.2, r0: 6, r1: -8 },
  { e: "🥬", left: "6%", top: "62%", size: 70, d: 14, delay: 0.4, r0: -10, r1: 5 },
  { e: "🍋", right: "5%", top: "56%", size: 56, d: 12, delay: 1.1, r0: 8, r1: -9 },
  { e: "🍅", left: "44%", top: "88%", size: 60, d: 13, delay: 2.6, r0: -6, r1: 8 },
  { e: "🌽", right: "22%", top: "82%", size: 62, d: 15, delay: 0.2, r0: 12, r1: -4 },
  { e: "🍓", left: "30%", top: "46%", size: 40, d: 10, delay: 1.8, r0: -9, r1: 7 },
  { e: "🫑", right: "40%", top: "68%", size: 44, d: 12, delay: 3, r0: 5, r1: -7 },
];

export function FloatingFruits() {
  return (
    <div className="fruits" aria-hidden="true">
      {ITEMS.map((f) => (
        <span
          key={f.e}
          className="fruit"
          style={
            {
              left: f.left, right: f.right, top: f.top, fontSize: f.size,
              "--d": `${f.d}s`, "--delay": `${f.delay}s`, "--r0": `${f.r0}deg`, "--r1": `${f.r1}deg`,
            } as React.CSSProperties
          }
        >
          {f.e}
        </span>
      ))}
    </div>
  );
}
