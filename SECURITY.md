# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x (latest) | Yes |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report security issues privately via [GitHub Security Advisories](https://github.com/anthropics/mcode/security/advisories/new) or by emailing the maintainer directly (see GitHub profile).

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You can expect an acknowledgement within 48 hours and a status update within 7 days.

## Scope

mcode is a desktop application that runs locally. It does not transmit data to external servers beyond what Claude Code itself sends to Anthropic. Security concerns in scope include:

- Electron context isolation bypasses
- IPC handler injection or privilege escalation
- Path traversal in file viewer or search
- Secrets exposure (API keys, credentials) via log output or IPC
- CSP bypasses in the renderer

Issues in bundled third-party dependencies should be reported upstream, but please notify us so we can track and update.
