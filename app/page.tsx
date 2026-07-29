import Link from "next/link";

export default function Home() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 32px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720 }}>
        <div style={{ marginBottom: 40 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--accent-subtle)",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent)",
              }}
            />
            Panel unificado
          </div>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: -0.5,
              marginBottom: 10,
              color: "var(--text-primary)",
            }}
          >
            Bienvenido a Panel MM
          </h1>
          <p
            style={{
              fontSize: 14.5,
              color: "var(--text-secondary)",
              lineHeight: 1.55,
              maxWidth: 520,
            }}
          >
            Herramientas de subtítulos y gestión de thumbnails, en un solo lugar.
            Elegí una sección para empezar.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          <ToolCard
            href="/subflow"
            label="Subflow"
            title="Subtítulos"
            description="Traducción, análisis y edición de SRT. Historial y export ZIP."
            accent
          />
          <ToolCard
            label="Thumb Manager"
            title="Vimeo Thumbnails"
            description="Gestión de miniaturas para Vimeo."
            soon
          />
        </div>
      </div>
    </div>
  );
}

interface ToolCardProps {
  href?: string;
  label: string;
  title: string;
  description: string;
  accent?: boolean;
  soon?: boolean;
}

function ToolCard({ href, label, title, description, accent, soon }: ToolCardProps) {
  const inner = (
    <div
      style={{
        padding: 20,
        borderRadius: 12,
        border: `1px solid ${soon ? "var(--border-subtle)" : "var(--border)"}`,
        background: "var(--bg-card)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        opacity: soon ? 0.6 : 1,
        transition: "border-color 0.15s, transform 0.15s, background 0.15s",
        cursor: soon ? "not-allowed" : "pointer",
      }}
      className={soon ? undefined : "panel-mm-tool-card"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: accent ? "var(--accent)" : "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
        {soon ? (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--bg-hover)",
              color: "var(--text-tertiary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            Soon
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: -0.2,
          color: "var(--text-primary)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {description}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}
