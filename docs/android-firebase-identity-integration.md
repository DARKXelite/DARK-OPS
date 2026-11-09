# Android Firebase Identity Integration

This contract targets the Clover Greens Ops native Android app (Kotlin + Jetpack Compose).

## Firebase dependencies

Use the same Firebase project `clover-greens-ops` and add the Firebase Auth, Cloud Functions and Firestore Android SDKs through the Firebase BoM. Add `kotlinx-coroutines-play-services` for `.await()` support. Callable Functions region is `asia-south1`.

Do not use Phone Auth in the Android app. Web Phone OTP and Android credentials are separate identities in the same Firebase project.

## Activation screen

Collect:
- Registered staff mobile number, normalized to E.164.
- One-time activation code supplied by an administrator.
- New password (minimum 12 characters).

Call `redeemAndroidInvite` with:
```kotlin
mapOf(
    "mobileNumber" to normalizedMobile,
    "activationCode" to activationCode,
    "newPassword" to newPassword
)
```

The callable returns `customToken` and `loginEmail`. Immediately sign in with:
```kotlin
FirebaseAuth.getInstance().signInWithCustomToken(customToken).await()
```

Never log, persist, or send the activation code to analytics. It is single-use, expires after 30 minutes and is limited to five failed attempts. If it expires, the administrator uses **New code** in Web User Management.

## Subsequent sign-in

The server creates an internal Firebase Auth email alias from the staff mobile number. Android must reproduce this algorithm exactly:

1. Normalize the mobile number to E.164 (for India, `9876543210` becomes `+919876543210`).
2. SHA-256 the UTF-8 E.164 string.
3. Take the first 32 lowercase hexadecimal characters.
4. Prefix `android-` and append `@android.clovergreens.invalid`.

Then call `signInWithEmailAndPassword(loginEmailAlias, password)`. The alias is a private Firebase Auth username, not a deliverable email address. Do not display it to users.

## Mandatory post-login authorization check

After either custom-token activation or email/password sign-in:

1. Read `app_roles/{currentUser.uid}`.
2. Require `active == true` and `platform == "android"`.
3. Read `users/{staffProfileId}` using the ID from the role document.
4. Require profile `status == "active"`, `platform == "android"`, `authUid == currentUser.uid`, and exact equality of `platformRole` and `moduleAccess` between the two documents.
5. If any check fails, sign out and show an access-disabled message.
6. Gate each screen by both the platform role and the exact module ID. A module grant does not automatically authorize every write action in that module.

Firestore Rules repeat the linked-identity and module checks. Do not create or update `app_roles`, `users`, or `android_invites` from the Android client.

## Role behavior

| Android role | Intended workflow |
|---|---|
| Operator | Assigned machine, shift and field reporting |
| Storekeeper | Inventory, inward and issue |
| Captain | Breakfast QR scanning, only with `breakfast_qr` |
| Marshal | Golf QR scanning, only with `golf_qr` |
| Workshop Manager | Workshop and maintenance, only with `workshop_ops`; fleet visibility additionally requires `fleet_ops` |

Allowed Android module IDs are `inventory`, `breakfast_qr`, `golf_qr`, `turf_ops`, `fleet_ops`, `workshop_ops`, and `other_modules`. The `other_modules` marker is not a wildcard.

## Password and account lifecycle

- Store no password in Firestore or local preferences.
- Use Firebase Auth's password reset/update APIs for a signed-in user.
- If the user forgets the password, an administrator reissues an activation code. Redeeming the new code sets a new password and returns a new custom token.
- If an administrator suspends the profile, `app_roles.active` becomes false and the Firebase Auth account is disabled. The app must sign out on the next authorization refresh or denied operation.
- Never fall back to Phone Auth, anonymous Auth, a hard-coded UID, or a default role when validation fails.

## Build and test checklist

- [ ] Activation succeeds with a valid one-time code.
- [ ] Reusing an activation code fails.
- [ ] Expired code fails.
- [ ] Wrong mobile number fails.
- [ ] Password shorter than 12 characters is rejected.
- [ ] Subsequent email/password sign-in works after app restart.
- [ ] Android identity cannot sign in through Web Phone OTP.
- [ ] Web identity cannot pass the Android platform check.
- [ ] Captain cannot access Golf QR without `golf_qr`.
- [ ] Marshal cannot access Breakfast QR without `breakfast_qr`.
- [ ] Missing module grant denies the module.
- [ ] Suspended account is denied.
- [ ] Existing machine, turf, inventory and QR transactions still work with their existing Firestore schemas.
