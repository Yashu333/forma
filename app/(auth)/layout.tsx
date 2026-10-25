// Padding never smaller than the notch, the home indicator or the landscape
// side insets in an installed iPhone app (viewport-fit=cover); 2rem top and
// bottom and 1rem at the sides as before everywhere else. Full height is the
// dynamic viewport, so the card centres in what's visible between browser bars.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex items-center justify-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-background">
      <div className="w-full max-w-sm animate-in-up">{children}</div>
    </div>
  );
}
