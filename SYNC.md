# install.sh is a mirror

`install.sh` in this repo is **not authored here**. It is a byte-for-byte
mirror of the canonical installer served at:

> https://agenticcontrolplane.com/install.sh

The canonical source lives in the **agenticcontrolplane.com marketing repo**,
because that is where harness integrations land (a new harness ships its
detection block there and deploys). This repo carries an identical copy so the
GitHub install path and the raw-repo path never disagree.

## Why a canonical + a mirror, not one file

The `curl -sf https://agenticcontrolplane.com/install.sh | bash` one-liner
doesn't follow redirects (`-sf`, no `-L`), so the file has to physically exist
at both locations. Keeping them identical is enforced by CI rather than by
memory — the two copies drifted for weeks once, in both directions, before this
gate existed (2026-08).

## The rule

1. **Author install.sh changes in the marketing repo**, deploy them, so the
   canonical URL updates.
2. **Resync this mirror** from canonical:
   ```bash
   curl -fsS https://agenticcontrolplane.com/install.sh -o install.sh
   git add install.sh && git commit -m "sync install.sh from canonical"
   ```
3. `.github/workflows/install-sync-check.yml` fails the build if this repo's
   `install.sh` differs from the live canonical — on push, on PR, and daily —
   so drift in either direction is caught, not discovered.
