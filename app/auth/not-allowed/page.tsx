import Link from "next/link";

export default function NotAllowedPage() {
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
          maxWidth: 400,
          padding: 28,
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--accent-subtle)",
            border: "1px solid var(--accent-border)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 15v2m-6 4h12a2 2 0 002-2v-7a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2zm10-12V7a4 4 0 00-8 0v4h8z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 6,
          }}
        >
          Acceso restringido
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          Tu cuenta de Google no está autorizada para entrar a este panel.
        </div>
        <Link
          href="/auth/signin"
          style={{
            display: "inline-block",
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            color: "var(--text-primary)",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Probar con otra cuenta
        </Link>
      </div>
    </div>
  );
}
