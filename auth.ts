import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return false;
      if (!user.email) return false;
      const list = allowedEmails();
      const normalized = user.email.trim().toLowerCase();
      if (!list.includes(normalized)) return "/auth/not-allowed";
      return true;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
});
