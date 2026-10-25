# Security policy and operational runbook

## Scope

Clover Greens Ops is an internal operational application backed by Firebase Authentication, Cloud Firestore, and Vercel. Treat workforce identities, inventory quantities, expense records, machine telemetry, purchase/receipt records, and turf-application records as operationally sensitive.

## Current controls in source

- Phone OTP sign-in and reCAPTCHA in the production entry point.
- Role records in `app_roles/{uid}` and explicit role checks in the application.
- Firestore rules with a default-deny catch-all, explicit active-role checks, F&B order/receipt validation, and protected receipt-linked inward records.
- Baseline browser security headers in `vercel.json`.
- Command-palette results rendered through data attributes rather than executable inline JavaScript.
- Configurable Firebase App Check initialization using the Vercel build variable `VITE_FIREBASE_APP_CHECK_SITE_KEY`.
- Static security regressions plus a Firestore Emulator test suite wired into CI.

A source declaration is not proof that a control is active in production. In particular, Firestore rules must be published to Firebase separately, and Firebase App Check/firewall settings must be enabled in their respective consoles.

## Required pre-production checklist

1. Verify the deployed production URL uses `src/ops-app.js`; do not re-enable `src/main.js` until its authentication flow is migrated and reviewed.
2. Publish the reviewed `firestore.rules` from this repository in the Firebase Console or through a controlled Firebase CLI release.
3. Sign in with each role and confirm positive and negative access cases.
4. Confirm the exact owner role document exists, has `active: true`, and is recoverable through the documented administrator process.
5. After the initial owner role is verified, remove the exceptional first-owner bootstrap from the client and rules in a separately tested change.
6. Create a reCAPTCHA Enterprise score-based site key for the production domain, set `VITE_FIREBASE_APP_CHECK_SITE_KEY` in Vercel Production, deploy, register the matching app in Firebase App Check, and observe valid/invalid request metrics. Enable enforcement for Firestore only after testing legitimate devices and preview environments. Do not put the reCAPTCHA secret key in Vercel client variables.
7. Confirm Firebase Phone provider, permitted SMS regions/quotas, authorized domains, account recovery, and alerting settings.
8. Confirm production backups/exports and complete a restore drill in a separate project.
9. Check the deployed response headers and verify CSP in report-only mode before enforcing a policy.
10. Test the production build and login/CRUD smoke flows after every release.

## Known hardening work still required

- Expand schema validation and emulator coverage to every collection, role, and write path. Current emulator tests focus on authentication gates, role limits, F&B receipts, and linked inward records.
- Add an auditable, append-only stock-movement ledger and idempotent posting/reversal for stock issues and expense-linked inventory changes.
- Narrow realtime subscriptions further to the active view and use pagination/aggregate documents for historical data; current code filters by role but still subscribes to every collection permitted for that role.
- Review the remaining dynamic HTML rendering and inline event handlers, then roll out a restrictive Content Security Policy in report-only mode before enforcement.
- Generate and commit a lockfile, keep dependencies updated, and review audit findings before release.
- Configure the App Check site key and Firebase-console enforcement; source integration alone does not activate the control without the key.
- Add monitoring for authentication abuse, unusual read/write volumes, permission-denied spikes, data-integrity errors, and failed posting transactions.

## Incident response

1. Disable the affected application role by setting `active: false` in `app_roles/{uid}` using a trusted administrator path.
2. Revoke Firebase Authentication refresh tokens for a compromised account using a trusted administrative process.
3. Preserve relevant Firebase/Vercel logs and note the time window and affected records.
4. Stop affected write workflows if stock or financial balances may be inconsistent.
5. Restore or reconcile data from an independently stored backup; do not overwrite history to hide the incident.
6. Rotate any exposed server-side credentials. Firebase web configuration values are client-visible by design; protect server credentials and private keys.
7. Re-enable access only after confirming identity, role, data integrity, and the relevant control.

## Reporting

Report suspected vulnerabilities privately to the project maintainer. Include the affected route/module, prerequisites, minimal reproduction steps, expected versus actual behavior, and potential operational impact. Do not test against real resort data or attempt destructive actions in production.
