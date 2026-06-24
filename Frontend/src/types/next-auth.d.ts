import type { DefaultSession } from 'next-auth';
import type { JWT as DefaultJWT } from 'next-auth/jwt';

// Shared identity types — kept local to avoid a circular import with index.ts
export type AccountStatus = 'pending' | 'active';
export type UserRole = 'Admin' | 'Editor' | 'Viewer' | 'None';

declare module 'next-auth' {
  interface Session {
    /** Google OAuth access token — forwarded for Forms API + Calendar API calls */
    accessToken?: string;
    /** Refresh token stored so FastAPI can refresh Calendar access independently */
    refreshToken?: string;
    user: DefaultSession['user'] & {
      accountStatus: AccountStatus;
      role: UserRole;
      /** True once the Admin has completed the onboarding wizard */
      profilingDone: boolean;
      /** UUID of the user's organization row */
      organizationId: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    accountStatus?: AccountStatus;
    role?: UserRole;
    profilingDone?: boolean;
    organizationId?: string;
    /** Unix ms timestamp of the last DB re-check for profilingDone */
    profilingRefreshedAt?: number;
  }
}
