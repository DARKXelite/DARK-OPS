# Android Phone OTP and Staff Access

The Android app uses the same Firebase Authentication Phone provider and the same Firebase Auth identity as the Web app. There are no activation codes, passwords, custom tokens, internal email aliases, or provisioning Cloud Functions.

## Sign-in flow

1. Collect the employee's mobile number in E.164 format (for India, `9876543210` becomes `+919876543210`).
2. Complete Firebase Phone Authentication using SMS OTP.
3. Read `FirebaseAuth.getInstance().currentUser`. Require a non-null, verified `phoneNumber`.
4. Query `users` with `whereEqualTo("mobileNumber", currentUser.phoneNumber)`. Firestore Rules allow this staff lookup only when the query is restricted to the authenticated user's verified phone number.
5. Require exactly one result. Validate:
   - `platform == "android"`
   - `status == "active"`
   - `platformRole` is present and valid for Android
   - `moduleAccess` is a list of known Android module IDs
   - `authUid` is null or equals `currentUser.uid`
6. In one Firestore batch, set `users/{staffProfileId}.authUid = currentUser.uid` and create `app_roles/{currentUser.uid}` from the profile:
   - `role = "storekeeper"` only for Storekeeper; otherwise `"operator"`
   - `active = true`
   - `platform = "android"`
   - `staffProfileId`, `platformRole`, and `moduleAccess` copied exactly from the profile
   - `updatedBy = currentUser.uid`
7. Read `app_roles/{currentUser.uid}` and the linked profile again. Require the role and profile to match exactly before opening the app.
8. Route to the role's landing screen and show only the modules in `moduleAccess`.

The batch is protected by Firestore Rules. The profile's mobile number must match Firebase's verified `phone_number` token claim, and the role document must match the profile. A client cannot claim another employee's profile or grant itself additional modules.

## Role and module behavior

| Android role | Expected landing/workflow |
|---|---|
| Operator | Assigned machine, shift and field reporting |
| Storekeeper | Inventory, inward and issue |
| Captain | Breakfast QR, only with `breakfast_qr` |
| Marshal | Golf QR, only with `golf_qr` |
| Workshop Manager | Workshop and maintenance with `workshop_ops`; fleet visibility also requires `fleet_ops` |

Allowed Android module IDs: `inventory`, `breakfast_qr`, `golf_qr`, `turf_ops`, `fleet_ops`, `workshop_ops`, `other_modules`. The `other_modules` marker is not a wildcard.

## Account behavior

- Admin adds the staff profile in Web User & Access Management: name, mobile, platform, role, module checklist and status.
- New profiles are active immediately but cannot enter an app until they complete OTP and claim their matching profile.
- Admin can suspend a profile. Its linked `app_roles.active` value is set false; Firestore Rules deny protected operations.
- A suspended or mismatched profile must sign out and show an access-denied message.
- Do not fall back to a hard-coded UID, default role, anonymous authentication, email/password, custom tokens, or activation codes.
- Do not write operational data until the post-login role/profile validation succeeds.

## Important platform boundary

Both apps use the same Auth UID. Each app must reject a profile whose `platform` does not match that app. Firestore Rules independently enforce the active linked identity and exact module grants, but Firestore Rules do not inherently know whether a request originated from the Web or Android client. Do not treat hidden navigation as a substitute for module-level rules.

## Device test checklist

- [ ] Android OTP succeeds for an active Android profile.
- [ ] Web profile is rejected by Android after OTP.
- [ ] Suspended profile is rejected.
- [ ] Unknown phone number is rejected.
- [ ] Duplicate staff profiles for one phone number are rejected.
- [ ] First OTP login claims the profile and creates the matching `app_roles` record.
- [ ] Subsequent OTP login reads the existing linked role.
- [ ] Captain cannot open Golf QR without `golf_qr`.
- [ ] Marshal cannot open Breakfast QR without `breakfast_qr`.
- [ ] Missing module grant is denied by Firestore Rules.
- [ ] Existing machine, turf, inventory and QR transactions retain their current schemas.
