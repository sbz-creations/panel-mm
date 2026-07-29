"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const stored = localStorage.getItem("theme") as "dark" | "light" | null;
    const resolved = stored ?? "light";
    setTheme(resolved);
    document.documentElement.setAttribute("data-theme", resolved);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }

  return (
    <button
      onClick={toggle}
      title="Cambiar tema"
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-card)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 0.15s",
        color: "var(--text-secondary)",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          "var(--accent-border)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          "var(--border)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-secondary)";
      }}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
          <path
            d="M8 2V1M8 15v-1M2 8H1M15 8h-1M3.5 3.5l-.7-.7M13.2 12.8l-.7-.7M3.5 12.5l-.7.7M13.2 3.2l-.7.7M11 8a3 3 0 11-6 0 3 3 0 016 0z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
          <path
            d="M8 3a5 5 0 100 10A5 5 0 008 3z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
