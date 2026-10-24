"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { useLocalClock } from "@/lib/frog/clock";
import { fetchReviewStatus, type ReviewStatus } from "./api";

// A quiet row at the top of Today: last week's "one focus" during the week it
// applies to, a nudge on the days a review is due, and a link to /review.
export default function ReviewNudge() {
  const clock = useLocalClock();
  if (!clock) return null;
  return <Inner today={clock.date} />;
}

function Inner({ today }: { today: string }) {
  const [status, setStatus] = useState<{ today: string; value: ReviewStatus } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchReviewStatus(today, ctrl.signal)
      .then((value) => setStatus({ today, value }))
      .catch(() => {
        // The row is a nicety; without the status it just shows the link.
      });
    return () => ctrl.abort();
  }, [today]);

  const value = status && status.today === today ? status.value : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {value?.thisWeekFocus && (
        <p className="text-muted-foreground min-w-0 break-words">
          This week: <span className="text-foreground font-medium">{value.thisWeekFocus}</span>
        </p>
      )}
      {value?.nudge && <p className="text-muted-foreground">Your weekly review is due.</p>}
      <Link href="/review" className={`${value?.nudge ? "btn-secondary" : "btn-ghost"} ml-auto`}>
        <CalendarCheck className="w-4 h-4" aria-hidden="true" /> Weekly review
      </Link>
    </div>
  );
}
