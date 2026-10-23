"use client";

import { useRouter } from "next/navigation";

const NAMES = ["Raghav", "Deepa"];

/** "Reviewing as" picker in the top bar. It only remembers a name in this browser; it is not a login. */
export function ReviewerSelect({ current }: { current: string | null }) {
  const router = useRouter();
  return (
    <label className="reviewer">
      <span>Reviewing as</span>
      <select
        value={current ?? ""}
        aria-label="Reviewing as"
        onChange={(e) => {
          document.cookie = `dp_reviewer=${encodeURIComponent(e.target.value)}; path=/; max-age=31536000; SameSite=Lax`;
          router.refresh();
        }}
      >
        <option value="" disabled>Choose…</option>
        {NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}
