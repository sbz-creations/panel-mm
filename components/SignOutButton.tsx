"use client";

import { useState } from "react";

export function SignOutButton() {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="submit"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        height: 34,
        padding: "0 12px",
        borderRadius: 8,
        border: `1px solid ${hover ? "var(--accent-border)" : "var(--border)"}`,
        background: "var(--bg-card)",
        color: hover ? "var(--accent)" : "var(--text-secondary)",
        fontSize: 12.5,
        fontWeight: 500,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        transition: "all 0.15s",
      }}
    >
      Cerrar sesión
    </button>
  );
}
