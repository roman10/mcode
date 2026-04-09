# Copilot Quota Tracking

mcode can display your GitHub Copilot premium request usage directly in the Stats panel. This requires the GitHub CLI (`gh`) to be installed and authenticated with the `user` scope.

## Setup

### 1. Install GitHub CLI

If you don't have `gh` installed:

```bash
brew install gh
```

### 2. Authenticate

```bash
gh auth login
```

Follow the prompts to authenticate with your GitHub account.

### 3. Grant the `user` scope

The default `gh` authentication does not include billing permissions. Add the required scope:

```bash
gh auth refresh -h github.com -s user
```

### 4. Verify

Confirm everything works by running:

```bash
gh api /users/YOUR_USERNAME/settings/billing/premium_request/usage
```

You should see a JSON response with your premium request usage data.

## Viewing in mcode

Once configured, your Copilot monthly quota appears under **AI Cost > Usage Quotas** in the Stats sidebar panel. It shows:

- Monthly premium request utilization (percentage bar)
- Time until quota resets (1st of each month UTC)
- Your GitHub username

The quota data refreshes automatically every 5 minutes, or manually via Cmd+R in the Stats panel.

## Troubleshooting

| Message in Stats panel | Fix |
|---|---|
| Install GitHub CLI: brew install gh | Run `brew install gh` |
| Run: gh auth login | Run `gh auth login` in terminal |
| Run: gh auth refresh -h github.com -s user | Run that command to grant the `user` scope |
| GitHub API unavailable | Check network; try `gh api /user` to test connectivity |

If you use Copilot through an organization, your personal billing endpoint may return empty data. In that case, your org admin controls quota visibility.

## How it works

mcode calls `gh api` under the hood to query the GitHub billing API for premium request usage. It does not store your GitHub token — authentication is delegated entirely to the `gh` CLI. Results are cached for 5 minutes to minimize API calls.
