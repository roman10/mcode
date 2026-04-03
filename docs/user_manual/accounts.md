# Account Management

mcode supports multiple AI provider accounts. This lets you run sessions under different accounts — for example, to separate personal and work usage, or to stay within usage limits.

> This page covers the in-app Accounts dialog, which is specifically for Claude Code and Copilot CLI sessions. Gemini and Codex authenticate through their CLI tools — run `gemini` or `codex` once to complete their respective auth flows; mcode does not manage those credentials. For setting up multi-account GitHub access over SSH, see [Multi-Account GitHub](multi-account-github.md).

## Opening the Accounts dialog

Click the **Accounts** button in the sidebar footer (next to the Settings gear icon).

## Account list

Each account block shows the account name and its status for each supported provider:

- **Green dot** — verified (authenticated, identity shown)
- **Amber dot** — not authenticated
- **"default" badge** — marks the primary account used when no account is explicitly selected

## Adding a secondary account

1. Click **+ Add account**. A new account is created.
2. The app background-verifies all supported providers. If you are already authenticated in your default environment, it might auto-detect your identity.
3. If not authenticated, click **Login** next to the provider (Claude or Copilot). A terminal tile opens automatically to run the authentication flow. Follow the prompts to log in.
4. Once logged in, click **Verify** next to the provider to confirm it authenticated successfully.
5. After the first provider is verified, you will be prompted to name the account (suggested based on your email/username).

## Verifying an account

Click the **refresh icon** next to any provider in an account block to check its current authentication status. Use this after re-authenticating in a terminal or if the status seems stale.

## Deleting an account

Click the trash icon on any secondary account row to remove it. The default account cannot be deleted.

## Selecting an account for a session

When multiple accounts are configured, an **Account** dropdown appears in the New Session dialog for supported session types (Claude and Copilot). Select which account to use and the agent process runs with that account's credentials.
