import { signIn } from "@/auth";

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl } = await searchParams;
  const redirectTo = callbackUrl ?? "/";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          padding: 28,
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--accent-subtle)",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            MM
          </span>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.1 }}>
            Panel MM
          </div>
        </div>

        <div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 6,
            }}
          >
            Iniciar sesión
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Ingresá con tu cuenta de Google autorizada para acceder al panel.
          </div>
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
        >
          <button
            type="submit"
            style={{
              width: "100%",
              height: 40,
              borderRadius: 10,
              border: "1px solid var(--accent-border)",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "background 0.15s",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
              <path
                fill="#fff"
                d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
              />
            </svg>
            Ingresar con Google
          </button>
        </form>
      </div>
    </div>
  );
}
