export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
         style={{ background: "var(--bg)" }}>
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-20%] left-[50%] -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[120px]"
             style={{ background: "rgba(124,110,248,0.08)" }} />
        <div className="absolute bottom-[-10%] left-[20%] w-[300px] h-[300px] rounded-full blur-[100px]"
             style={{ background: "rgba(99,90,220,0.06)" }} />
      </div>
      <div className="relative w-full max-w-sm animate-in-up">{children}</div>
    </div>
  );
}
