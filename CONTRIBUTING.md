# Contributing to Folium

By submitting a contribution you agree that:
- It is your original work or you have the right to submit it
- You license it under the same MIT License that covers this project

## Core principles — do not break these

1. No external data transmission — canvas data must never leave the user's device
2. No cookies — do not introduce any tracking mechanism
3. No mandatory accounts — the app must work without login or registration
4. No new remote dependencies at runtime — no CDN scripts, remote fonts,
   or external API calls without community discussion
5. Encryption must remain — do not weaken or remove local AES-256 encryption

If your feature requires any of the above, open an issue first.

## How to contribute

Reporting bugs: open a GitHub issue with steps to reproduce.
Security issues: see SECURITY.md — do not open a public issue.
Feature suggestions: open an issue with label enhancement,
describe the use case and how it fits the local-first model.

Submitting code:
1. Fork the repo and create a branch from main
2. Make focused, well-described commits
3. Run before submitting:
   npm install && npm run build && npm audit --audit-level=high
4. Open a pull request describing what changed and why

Code rules:
- TypeScript strict mode — no any without justification
- No dangerouslySetInnerHTML, eval(), or direct innerHTML
- No console.log in production paths
- No new dependency without justification (see below)

Adding dependencies:
- Is this available natively in modern browsers?
- Does it have a good security track record?
- Does it phone home or add external network calls?
- Is it actively maintained?

## Liability

Folium is provided under MIT "as is", without warranty of any kind.
Contributors are not liable for how the software is used.
Maintainers are not liable for contributions merged in good faith.
