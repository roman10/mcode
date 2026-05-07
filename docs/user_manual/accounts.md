# Profiles

mcode lets you keep multiple isolated workspaces — each with its own credentials for every supported AI CLI — and pick which one a session runs under. Use this to separate personal and work usage, stay within usage limits, or test alternate accounts without disturbing your default setup.

> The in-app dialog is labelled **Profiles**. It manages credentials for all four supported agents — Claude Code, Codex CLI, Gemini CLI, and Copilot CLI — by giving each profile its own isolated config directory.
>
> Looking for multi-account git/GitHub setup over SSH? See [Multi-Account GitHub](multi-account-github.md). That is independent from the in-app profiles described here.

## Opening the Profiles dialog

Click the **Profiles** icon (people icon) in the sidebar footer, next to the Settings gear.

## What a profile is

Each profile is an isolated workspace. The **default** profile uses your system `$HOME`, so it inherits whatever you have already authenticated outside mcode. Secondary profiles get their own config directories, so logging in inside one profile doesn't touch the others.

Every profile shows one row per supported CLI (Claude, Codex, Gemini, Copilot). Each row indicates that CLI's connection status within that profile.

## Status indicators

| Dot | Meaning |
|---|---|
| Green | Connected (the CLI is authenticated in this profile; the verified identity is shown next to the row) |
| Red | The CLI binary is not installed on your machine. Click **Install** for help. |
| Gray | Not connected — the CLI is installed but no credentials exist for this profile yet |

The default profile is labelled `default · uses your system $HOME`. Secondary profiles show their name and a delete (trash) icon.

## Adding a profile

1. Click **+ Add Profile**. A new profile is created and mcode background-verifies every supported CLI for it. If you happened to already be authenticated in your default environment, an identity may auto-detect.
2. For each CLI you want enabled in this profile, click **Connect** next to its row. A terminal tile opens automatically running that CLI's auth flow — follow the prompts to sign in. Profile-specific config is written into the profile's isolated directory, not your `$HOME`.
3. The first time mcode detects a successful auth in a freshly created profile, it prompts you to **name the profile** (suggested from your email/username). You can save the suggestion or skip and rename later.

## Verifying a connection

Click the small **circular arrows** (refresh) icon at the right of any CLI row to re-check its status. Use this after re-authenticating in a terminal or if the row looks stale.

## Deleting a profile

Click the trash icon in a secondary profile's header. The default profile cannot be deleted.

## Selecting a profile for a new session

When more than one profile exists, the New Session dialog shows an **Account** dropdown listing each profile and the identity verified for that agent. The agent process runs against the selected profile's config, so credentials and per-CLI settings stay scoped to that profile.

## How isolation works

mcode points each CLI at a profile-specific config directory (for example `CLAUDE_CONFIG_DIR`, Codex/Gemini/Copilot equivalents). Logging in or running tools inside one profile leaves the others untouched. Quotas and usage stats roll up per profile in the [Stats panel](sidebar-panels.md#stats).
