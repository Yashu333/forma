// Top/bottom padding never smaller than the notch or home indicator in an
// installed iPhone app (viewport-fit=cover); 2rem as before everywhere else.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-background">
      <div className="w-full max-w-sm animate-in-up">{children}</div>
    </div>
  );
}
