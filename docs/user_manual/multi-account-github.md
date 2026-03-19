# Multi-Account GitHub Setup

Push to multiple GitHub repos with different accounts without manually switching credentials.

## Problem

When you have multiple GitHub accounts (e.g., a personal and a work account) owning different repos, tools like `gh auth switch` require manual switching before every push or PR operation.

## Solution

SSH host aliases route `git push` to the correct account automatically. A shell wrapper handles `gh` CLI operations (PRs, issues, etc.).

## Step 1: Generate SSH Keys

Create one key per GitHub account:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_account1 -C "account1@example.com" -N ""
ssh-keygen -t ed25519 -f ~/.ssh/id_account2 -C "account2@example.com" -N ""
```

## Step 2: Create SSH Config

Create or edit `~/.ssh/config`:

```
Host github-account1
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_account1

Host github-account2
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_account2
```

## Step 3: Add Public Keys to GitHub

For each account, log into GitHub and go to **Settings > SSH and GPG keys > New SSH key**, then paste the contents of the corresponding `.pub` file:

```bash
cat ~/.ssh/id_account1.pub
cat ~/.ssh/id_account2.pub
```

Verify the keys work:

```bash
ssh -T git@github-account1   # "Hi account1!"
ssh -T git@github-account2   # "Hi account2!"
```

## Step 4: Update Repo Remotes

Switch each repo from HTTPS to its SSH alias:

```bash
# In repo owned by account1
git remote set-url origin git@github-account1:account1/repo-name.git

# In repo owned by account2
git remote set-url origin git@github-account2:account2/repo-name.git
```

After this, `git push` and `git pull` use the correct SSH key automatically.

## Step 5: Auto-Switch `gh` CLI Account

Add this function to your shell config (`~/.zshrc` or `~/.bashrc`):

```bash
# Auto-switch gh CLI account based on repo remote
gh() {
  local remote_url
  remote_url=$(git remote get-url origin 2>/dev/null)
  case "$remote_url" in
    *account1*) command gh auth switch --user account1 2>/dev/null ;;
    *account2*) command gh auth switch --user account2 2>/dev/null ;;
  esac
  command gh "$@"
}
```

This makes `gh pr create`, `gh issue list`, etc. auto-switch to the correct account based on the current repo's remote URL.

## How It Works

- **SSH host aliases** map a fake hostname (e.g., `github-account1`) to `github.com` with a specific SSH key. Git sees the alias in the remote URL and uses the right key.
- **The `gh` wrapper** inspects the current repo's remote URL before every `gh` command and switches to the matching account silently.

## Adding More Accounts

1. Generate a new key: `ssh-keygen -t ed25519 -f ~/.ssh/id_account3 ...`
2. Add a new `Host` block to `~/.ssh/config`
3. Add the public key to the new GitHub account
4. Add a new `case` pattern to the `gh` wrapper
