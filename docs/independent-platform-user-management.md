# Independent Platform User Management Contract

Status: proposed shared contract, schema foundation only. This document is the implementation handoff for the Android Studio agent and the Web app implementation.

## Non-negotiable rule

A staff profile belongs to exactly one platform:

- `platform: "web"`
- `platform: "android"`

There is no `both` value. Do not infer platform from role, device, or module. Do not create two platform assignments for one staff profile.

## Role catalog

### Web App
| ID | Display label |
|---|---|
| `operator` | Operator |
| `foe` | Front Office Executive (FOE) |
| `marshal` | Marshal |
| `storekeeper` | Storekeeper |
| `workshop_manager` | Workshop Manager |
| `golf_superintendent` | Golf Superintendent |
| `user` | User |

### Android App
| ID | Display label |
|---|---|
| `operator` | Operator |
| `storekeeper` | Storekeeper |
| `captain` | Captain (Breakfast QR) |
| `marshal` | Marshal (Golf QR) |
| `workshop_manager` | Workshop Manager |

The role list shown in the create/edit form must be filtered by the selected platform. Changing platform must clear an incompatible role and remove modules unavailable on that platform.

## Module catalog

| Module ID | Label | Web | Android |
|---|---|---:|---:|
| `fuel_fertilizer_dashboard` | Fuel & Fertilizer Dashboard | Yes | No |
| `inventory` | Inventory | Yes | Yes |
| `breakfast_qr` | Breakfast QR | Yes | Yes |
| `golf_qr` | Golf QR | Yes | Yes |
| `turf_ops` | Turf Ops | Yes | Yes |
| `fleet_ops` | Fleet Ops | Yes | Yes |
| `workshop_ops` | Workshop Ops | Yes | Yes |
| `reports` | Reports & Analytics | Yes | No |
| `other_modules` | Other modules (future module grants) | Yes | Yes |

Only modules listed as available for the selected platform may be assigned. `other_modules` is a future-module marker only; it is not a wildcard permission and must not grant access to arbitrary collections or screens. Role defaults may preselect sensible modules, but Admin must be able to review the final module list.

## Firestore data model

### 1. `users/{staffProfileId}` (staff directory / profile)

Add these fields without removing or renaming existing fields:

```ts
type StaffProfile = {
  fullName: string;
  username: string;             // legacy compatibility, same as fullName
  mobileNumber: string;         // normalized E.164, e.g. +919876543210
  role: string;                 // legacy compatibility; mirror platformRole
  platform: "web" | "android";  // exactly one
  platformRole: string;         // must exist in PLATFORM_ROLES[platform]
  moduleAccess: string[];       // module IDs from USER_MODULES
  status: "pending" | "active" | "suspended";
  schemaVersion: 1;
  authUid: string | null;       // UID for this platform's Firebase Auth identity
  createdAt: Timestamp;
  createdBy: string;            // creator's Firebase UID
  updatedAt: Timestamp;
  updatedBy: string;            // last editor's Firebase UID
};
```

Keep the existing auto-generated document ID. Do not key this collection by mobile number and do not overwrite or migrate existing workforce documents automatically.

### 2. `app_roles/{authUid}` (server-enforced authorization)

This remains the authorization document read by Firestore Security Rules. Extend it additively:

```ts
type AppRole = {
  role: string;                 // security role understood by the relevant client/rules
  active: boolean;
  platform: "web" | "android";
  staffProfileId: string;       // users/{staffProfileId}
  platformRole: string;
  moduleAccess: string[];
  updatedAt: Timestamp;
  updatedBy: string;
  displayName?: string;
};
```

The `app_roles` record must be created for the actual Firebase Auth UID used by that platform. A profile without an auth UID / role record is `pending`, not an active login.

## Authentication and security requirements

- The current Web App uses Firebase Phone OTP. Keep that sign-in flow unless the product owner approves a change.
- Android must use a distinct Firebase Auth identity from the Web identity, even when both identities refer to the same staff mobile number.
- Do not use the same Firebase Auth UID for both clients.
- Do not assume Firestore can identify whether a request came from a browser or Android app. Firestore Rules see the authenticated UID and token claims, not a trustworthy client-platform label.
- Do not treat a client-side check of `users.platform` or hidden navigation as authorization.
- Enforce `platform`, `active`, role and module permissions in Firestore Rules / trusted backend. Deny access when platform or profile linkage does not match.
- Never create Firebase Auth users, mint custom tokens, or store credentials from browser code. If Admin must provision Android identities, implement a trusted server-side provisioning endpoint (Cloud Function or equivalent) using Firebase Admin SDK, with admin authorization and audit logging.
- Phone OTP identities cannot simply be duplicated for the same phone number inside one Firebase project. The Android agent must not silently create a second phone-auth account. Coordinate the Android sign-in method with the backend implementation (for example, app-specific credentials or server-minted custom tokens).
- Preserve the existing one-time admin bootstrap and existing data. Do not loosen catch-all rules or grant broad access to make the UI work.
- Existing `users` documents and existing `app_roles` documents need a backward-compatible migration plan. Do not bulk rewrite them from the client.

## Android Studio agent implementation brief

Implement Android consumption of this exact contract:

1. Parse `users/{staffProfileId}` and `app_roles/{authUid}` using the fields above.
2. Require `platform == "android"`, `status == "active"`, `app_roles.active == true`, and matching `staffProfileId` before entering the app.
3. Reject Web profiles and Web auth-role documents. Do not fall back to a generic role if fields are missing.
4. Use `platformRole` for role-specific field workflows:
   - Operator: assigned machine / shift / field reporting workflows.
   - Storekeeper: inventory, inward/issue and stock workflows.
   - Captain: breakfast coupon scanning only when `breakfast_qr` is granted.
   - Marshal: golf coupon scanning only when `golf_qr` is granted.
   - Workshop Manager: workshop, maintenance and fleet service workflows.
5. Gate each module by both `moduleAccess` and the role's allowed actions. A module grant is not permission to perform every write in that module.
6. Keep all Firestore writes compatible with the existing collection schemas and current transaction invariants. Do not rename collections or fields.
7. Do not change Firebase project configuration or deploy Firestore Rules. Submit code and proposed rule changes for review.
8. Add tests for: platform mismatch, inactive profile, missing role document, invalid role/platform pair, missing module grant, and valid role/module combinations.

## Web App implementation brief

- Add a dedicated User & Access Management screen.
- Create/edit form fields: full name, mobile, platform, platform-specific role, module access, status.
- Platform selector must be a required single-select (Web App OR Android App).
- Display only roles and modules available on the selected platform.
- Preserve legacy fields `fullName`, `username`, `mobileNumber`, and `role` while adding the new fields.
- Display platform, role, status and granted modules in the user list.
- Do not mark a user active until the corresponding platform auth identity and `app_roles` document have been provisioned.
- Keep current authentication, database collection names, and existing operational workflows intact.

## Shared implementation source

The canonical enums, module catalog, profile builder and validation are in `src/modules/user-management.js`. Import these constants rather than duplicating role/module strings in either client.
