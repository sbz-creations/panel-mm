import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SidebarLink } from "@/components/SidebarLink";
import { SignOutButton } from "@/components/SignOutButton";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Panel MM",
  description: "Unified panel for Subflow and Thumb Manager",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html
      lang="en"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ fontFamily: geistSans.style.fontFamily }}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t||'light');})();`,
          }}
        />
      </head>
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          background: "var(--bg)",
          color: "var(--text-primary)",
        }}
      >
        {session?.user ? (
          <aside
            style={{
              width: 232,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-card)",
              borderRight: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                padding: "20px 20px 18px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <Link
                href="/"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textDecoration: "none",
                  color: "var(--text-primary)",
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: "var(--accent-subtle)",
                    border: "1px solid var(--accent-border)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                  }}
                >
                  MM
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.1 }}>
                  Panel MM
                </span>
              </Link>
            </div>

            <nav
              style={{
                flex: 1,
                padding: "16px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflowY: "auto",
              }}
            >
              <SectionLabel>Subflow</SectionLabel>
              <SidebarLink href="/subflow" icon={<SubtitlesIcon />}>
                Abrir Subflow
              </SidebarLink>

              <div style={{ height: 14 }} />
              <SectionLabel>Thumb Manager</SectionLabel>
              <SidebarLink href="/thumb" icon={<ImageIcon />}>
                Vimeo Thumbs
              </SidebarLink>
            </nav>

            <div
              style={{
                padding: "12px 12px 14px",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "0 4px",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    flexShrink: 0,
                  }}
                >
                  {(session.user.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div
                  title={session.user.email ?? ""}
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {session.user.email}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <ThemeToggle />
                <form
                  style={{ flex: 1 }}
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/auth/signin" });
                  }}
                >
                  <SignOutButton />
                </form>
              </div>
            </div>
          </aside>
        ) : null}
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "6px 10px 4px",
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

function SubtitlesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
      <rect
        x="1.5"
        y="3"
        width="13"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M4 8.5h3M9 8.5h3M4 10.5h5M10.5 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="5.5" cy="6.5" r="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2 12l4-4 3 3 2-2 3 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

