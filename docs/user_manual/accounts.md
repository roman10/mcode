# Account Management

mcode supports multiple Claude accounts. This lets you run sessions under different accounts — for example, to separate personal and work usage, or to stay within usage limits.

> This page covers the in-app Accounts dialog. For setting up multi-account GitHub access over SSH, see [Multi-Account GitHub](multi-account-github.md).

## Opening the Accounts dialog

Click the **Accounts** button in the sidebar footer (next to the Settings gear icon).

## Account list

Each account row shows:

- **Green dot** — verified (authenticated, email shown)
- **Amber dot** — not authenticated
- **"default" badge** — marks the primary account used when no account is explicitly selected

## Adding a secondary account

1. Click **+ Add account**
2. Enter a name for the account
3. Press `Cmd+Enter` or click **Create**

A terminal tile opens automatically and runs `claude` for authentication. Follow the prompts to log in.

4. Once logged in, click **Verify** next to the account to confirm it authenticated successfully.

## Verifying an account

Click **Verify** next to any account to check its current authentication status. Use this if an account shows amber (not authenticated) or after re-authenticating in a terminal.

## Deleting an account

Click the trash icon on any secondary account row to remove it. The default account cannot be deleted.

## Selecting an account for a session

When multiple accounts are configured, an **Account** dropdown appears in the New Session dialog for Claude sessions. Select which account to use and the Claude Code process runs with that account's credentials. Codex sessions do not currently use mcode's account selector.

In the kanban view, session cards show the account name beneath the session label when it's not the default account.
