/**
 * Shared NextAuth options.
 * Imported by the [...nextauth] route handler AND any server-side
 * getServerSession() call (e.g. the /api/forms/publish route).
 *
 * Google Cloud setup required before publishing works:
 *   1. Enable "Google Forms API" at console.cloud.google.com/apis/library
 *   2. The OAuth consent screen must include the forms.body scope
 */
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // forms.body is required to create and populate Google Forms
          scope:
            "openid email profile https://www.googleapis.com/auth/forms.body",
          // Force consent screen so users who previously signed in without
          // the forms scope re-grant it on their next sign-in.
          prompt: "consent",
          access_type: "offline",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // account is only present on the initial sign-in; persist the token.
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      (session as typeof session & { accessToken?: string }).accessToken =
        token.accessToken as string | undefined;
      return session;
    },
  },
};
