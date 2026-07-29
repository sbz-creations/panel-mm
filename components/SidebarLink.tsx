"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

interface SidebarLinkProps {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  soon?: boolean;
}

export function SidebarLink({
  href,
  icon,
  children,
  disabled = false,
  soon = false,
}: SidebarLinkProps) {
  const pathname = usePathname();
  const active =
    !disabled && (pathname === href || pathname.startsWith(`${href}/`));
  const [hover, setHover] = useState(false);

  const base = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
    border: "1px solid transparent",
  } as const;

  const styleActive = {
    background: "var(--accent-subtle)",
    border: "1px solid var(--accent-border)",
    color: "var(--accent)",
  };

  const styleHover = {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
  };

  const styleDisabled = {
    color: "var(--text-tertiary)",
    cursor: "not-allowed",
  };

  const styleIdle = {
    color: "var(--text-secondary)",
  };

  const merged = {
    ...base,
    ...(disabled ? styleDisabled : hover ? styleHover : styleIdle),
    ...(active ? styleActive : {}),
  };

  const content = (
    <>
      {icon ? (
        <span
          style={{
            display: "inline-flex",
            width: 16,
            height: 16,
            alignItems: "center",
            justifyContent: "center",
            color: "currentColor",
          }}
        >
          {icon}
        </span>
      ) : null}
      <span style={{ flex: 1 }}>{children}</span>
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
    </>
  );

  if (disabled) {
    return (
      <div
        style={merged}
        onMouseEnter={() => setHover(false)}
        aria-disabled="true"
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      style={merged}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {content}
    </Link>
  );
}
