import Link from "next/link";

interface ErrorPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function AuthErrorPage({ searchParams }: ErrorPageProps) {
  const { error } = await searchParams;

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
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 8v5M12 16.5h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L12.87 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z"
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
          Error de autenticación
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            marginBottom: 12,
          }}
        >
          Hubo un problema al iniciar sesión.
        </div>
        {error ? (
          <div
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 11.5,
              color: "var(--text-tertiary)",
              padding: "8px 10px",
              borderRadius: 6,
              background: "var(--bg-hover)",
              border: "1px solid var(--border-subtle)",
              marginBottom: 20,
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        ) : null}
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
          Volver a intentar
        </Link>
      </div>
    </div>
  );
}
