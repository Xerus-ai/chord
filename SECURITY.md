# Security Policy

## Reporting a vulnerability

Please report security issues privately, through GitHub's private vulnerability reporting:
open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a
public issue, pull request or discussion for a suspected vulnerability.

Include what you found, how to reproduce it, the version (Settings → About, or the release
tag) and the impact you expect. We reply on the advisory and keep you posted until it is
fixed and released.

## Supported versions

Fixes land on `main` and ship in the next release. Only the latest release is supported; the
app updates itself, so please update before reporting.

## Scope

In scope: the Chord desktop app in this repository, its sync server (`server/`) and the wire
contract (`packages/protocol`). Out of scope: third-party agents and CLIs that Chord launches
(report those to their maintainers), and denial-of-service against a server you run yourself.
