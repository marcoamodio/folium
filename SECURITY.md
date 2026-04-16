# Security Policy

## Supported versions

Only the latest version on the main branch receives security fixes.

## Our security model

Folium is a local-first, zero-knowledge application:
- All data is stored on the user's device, encrypted with AES-256
- No user data is ever transmitted to any server
- There is no backend, no authentication system, no database on our side
- There are no API keys or secrets in this codebase

The primary attack surface is the browser environment of the user's device.
We do not hold any data that could be breached on our end.

## Reporting a vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Report privately via:
- GitHub private security advisory (preferred): use the "Report a vulnerability"
  button in the Security tab of this repository
- Email: info.folium@proton.me

Please include: description, steps to reproduce, potential impact,
and a suggested fix if possible.

## What to expect

- Acknowledgement within 72 hours
- Fix within 14 days for critical issues
- Credit in release notes unless you prefer anonymity

## Scope

In scope:
- XSS vulnerabilities in canvas or input handling
- Weaknesses in local encryption implementation
- CSP bypass vectors
- Dependencies with realistic exploitation paths
- Privacy leaks (unintended external network requests)

Out of scope:
- Vulnerabilities in the user's browser or OS
- Attacks requiring physical device access
- Theoretical attacks with no realistic exploitation path

## Disclosure

We follow coordinated disclosure. We ask for reasonable time to fix before
public disclosure. We will not pursue legal action against researchers
acting responsibly under this policy.
