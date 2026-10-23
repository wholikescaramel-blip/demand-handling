import { cookies } from "next/headers";

/** Who can review. No login: whoever is using the dashboard picks their name in the top bar, and decisions are recorded under it. */
export const REVIEWERS = ["Raghav", "Deepa"] as const;
export const REVIEWER_COOKIE = "dp_reviewer";

export async function currentReviewer(): Promise<string | null> {
  const v = (await cookies()).get(REVIEWER_COOKIE)?.value;
  return v && (REVIEWERS as readonly string[]).includes(v) ? v : null;
}
