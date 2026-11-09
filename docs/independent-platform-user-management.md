# Shared Phone OTP Staff Access Contract

## Core rule

Every employee has one staff profile and one Firebase Authentication identity. Both Web and Android use Firebase Phone Authentication with SMS OTP. The staff profile assigns the employee to exactly one app:

- `platform: "web"`
- `platform: "android"`

The same verified mobile number must not appear in multiple staff profiles.

## Admin workflow

In Web User & Access Management, Admin enters:
- Full name
- Mobile number (normalized to E.164)
- App type (Web or Android)
- Platform-specific role
- Module access checkboxes
- Status (Active or Suspended)

Saving creates or updates the staff profile. There is no provisioning action, activation code, password, custom token, internal email alias, or identity-linking form.

## Firestore data model

### `users/{staffProfileId}`

Preserve existing fields and document IDs. The access fields are:

```ts
type StaffProfile = {
  fullName: string;
  username: string;             // legacy compatibility
  mobileNumber: string;         // normalized E.164
  role: string;                 // legacy compatibility, mirrors platformRole
  platform: "web" | "android";
  platformRole: string;
  moduleAccess: string[];
  status: "active" | "suspended";
  schemaVersion: 1;
  authUid: string | null;       // claimed on first successful OTP login
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
};
```

### `app_roles/{authUid}`

The first successful OTP login atomically claims the matching profile and creates the role document:

```ts
type AppRole = {
  role: "operator" | "storekeeper";
  active: boolean;
  displayName: string;
  platform: "web" | "android";
  staffProfileId: string;
  platformRole: string;
  moduleAccess: string[];
  updatedAt: Timestamp;
  updatedBy: string;
};
```

The coarse `role` remains compatible with existing Firestore Rules and Web RBAC: Storekeeper maps to `storekeeper`; other platform roles map to the least-privileged `operator`. The exact platform role remains in `platformRole`.

## First-login claim

After Firebase Phone OTP, the client:
1. Reads the verified `currentUser.phoneNumber`.
2. Queries `users` by exact `mobileNumber == phoneNumber`.
3. Requires exactly one active profile assigned to that client platform.
4. Requires `authUid` to be empty or already equal to the current Auth UID.
5. Atomically updates the profile's `authUid` and creates `app_roles/{uid}` from the profile.
6. Re-reads both documents and checks their platform, active status, role and module grants before opening the app.

Firestore Rules permit the lookup only for the exact verified phone number. They permit the profile claim and role creation only when the phone claim matches the profile and the two writes agree. A client cannot grant itself a role or module that is absent from the admin-created profile.

## Role catalog

### Web
`operator`, `foe`, `marshal`, `storekeeper`, `workshop_manager`, `golf_superintendent`, `user`.

### Android
`operator`, `storekeeper`, `captain`, `marshal`, `workshop_manager`.

## Module catalog

| Module ID | Web | Android |
|---|---:|---:|
| `fuel_fertilizer_dashboard` | Yes | No |
| `inventory` | Yes | Yes |
| `breakfast_qr` | Yes | Yes |
| `golf_qr` | Yes | Yes |
| `turf_ops` | Yes | Yes |
| `fleet_ops` | Yes | Yes |
| `workshop_ops` | Yes | Yes |
| `reports` | Yes | No |
| `fnb_ops` | Yes | No |
| `other_modules` | Yes | Yes |

`other_modules` is a future marker, not wildcard permission.

## Security boundaries

- Firestore Rules enforce active identity linkage and exact module grants.
- Staff lookup must be constrained to the authenticated user's verified phone number.
- Only managers can create, edit or delete staff profiles.
- A staff member may only claim their own matching profile.
- Admin edits to a linked profile and its `app_roles` document must be committed atomically.
- The app must reject the wrong platform and sign out when the profile is inactive or mismatched.
- Firestore Rules cannot inherently identify whether a request came from Web or Android. Platform rejection is therefore also required in each client; collection-level module grants remain enforced by Rules.
- Do not change operational collection names, stored transaction schemas, Firebase project configuration, or existing data.

## Deployment

This repository no longer contains the Android provisioning Cloud Functions or activation-code workflow. Firestore Rules and the Web client changes must pass emulator tests and be reviewed before deployment. The native Android client must implement the OTP/profile-claim contract in `docs/android-firebase-identity-integration.md`.
