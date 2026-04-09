// Build-time constants injected by Vite define() in electron.vite.config.ts.
// Values come from GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET env vars,
// loaded from .env.local (dev) or .env.signing (CI/release) — see .env.local.template.
declare const __GEMINI_OAUTH_CLIENT_ID__: string;
declare const __GEMINI_OAUTH_CLIENT_SECRET__: string;
