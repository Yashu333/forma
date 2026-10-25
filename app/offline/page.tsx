import type { Metadata } from "next";
import BrandMark from "@/components/ui/BrandMark";
import ReloadWhenOnline from "@/components/pwa/ReloadWhenOnline";

// The service worker's offline fallback (docs/mobile-pwa/SPEC.md, P2). It is
// precached on install and served in place of any page the network can't
// reach, so it stays static: no auth, no data, outside the app shell. The
// proxy matcher lets /offline through signed out.
export const metadata: Metadata = {
  title: "Offline · Forma",
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <main
      className="min-h-dvh flex items-center justify-center bg-background"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <BrandMark size={40} />
        <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
          You&apos;re offline
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Forma will reload when you&apos;re back online.</p>
        {/* A plain link to this same URL: retries the page this offline copy
            stands in for, and works even if the page's JS never loads. */}
        <a href="" className="btn-primary mt-6 h-11 min-w-32">
          Retry
        </a>
      </div>
      <ReloadWhenOnline />
    </main>
  );
}
