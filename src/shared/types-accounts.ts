// --- CLI / Auth Status ---

export type CliAuthStatus = 'ok' | 'cli-not-found' | 'not-authenticated';

// --- Account Profiles ---

export interface AccountProfile {
  accountId: string;
  name: string;
  isDefault: boolean;
  homeDir: string | null; // null for default account (uses real ~/.claude/)
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AccountProviderIdentity {
  accountId: string;
  sessionType: string;
  authStatus: CliAuthStatus;
  identity: string | null;
  displayName: string | null;
  lastCheckedAt: string | null;
  lastAuthenticatedAt: string | null;
}

export interface AccountProfileWithProviders extends AccountProfile {
  providers: Partial<Record<string, AccountProviderIdentity>>;
}

export interface AuthStatusResult {
  status: CliAuthStatus;
  email?: string;         // kept — renderer reads this for Claude
  identity?: string | null;      // provider-neutral: email, username, auth mode
  displayName?: string | null;   // optional human-friendly label
}
