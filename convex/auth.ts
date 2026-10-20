import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

// Single-user app: only the address stored in the ALLOWED_EMAIL Convex env var
// can sign up or sign in. Nothing about it is hardcoded here.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
        if (!allowed || email !== allowed) {
          throw new Error("This coach is private.");
        }
        return { email };
      },
    }),
  ],
});
