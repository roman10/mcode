# Testing

- **Run tests first:** At the start of each coding session on existing code, run the full test suite. This orients the agent to the project's scope and reveals any pre-existing failures before making changes.
- **Use red/green TDD:** Write failing tests before asking the agent to implement. Confirm they fail (red), then implement to make them pass (green). "Red/green TDD" is understood as a prompt shorthand by all major models.
- When testing using MCP / APIs, start a new dev instance with "npm run dev", don't use the current running production version to avoid polluting the production version database. If needed, copy production db to dev build location to test.
- Always check to see if we can add an integration test case or update existing integration test to prevent issues from happening again or test the new features are working as intended.
