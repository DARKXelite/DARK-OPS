# RBAC and Firebase setup

The application now authenticates with Firebase Email/Password and reads the assigned application role from `app_roles/{firebase-auth-uid}`. Firestore rules enforce role access on the server; hiding buttons in the browser is only a usability layer.

## Before enabling the release

1. In Firebase Console → Authentication → Sign-in method, enable **Email/Password** and create the initial administrator account.
2. In Firebase Console → Project settings → Your apps, copy the **Web app** configuration. Update `firebaseConfig.appId` in `src/ops-app.js` to the Web app ID. The current value is marked as a TODO and is an Android app ID.
3. In Firestore, create a document in the `app_roles` collection whose document ID is the initial administrator's Firebase Auth UID. Use:

```json
{
  "role": "admin",
  "active": true,
  "displayName": "Operations Administrator"
}
```

4. Install/use Firebase CLI, authenticate to the correct project, and deploy the committed rules:

```sh
firebase login
firebase use clover-greens-ops
firebase deploy --only firestore:rules
```

The `firebase.json` file points to `firestore.rules`. Confirm the intended Firebase project before deployment.
5. Sign in to Clover Greens Ops with the administrator account. Open **Users** → **Manage app access** to assign roles to other Firebase Auth UIDs. Users must already exist in Firebase Authentication.
6. Test with one account per role before general rollout. Verify denied reads/writes as well as allowed operations.

## Roles

- `admin`: full application and access-role administration.
- `manager`: fleet, fuel, shifts, turf operations, inventory, expenses, F&B, reports and workforce records.
- `storekeeper`: inventory, goods receipts, fuel, F&B ordering/receiving and turf stock issue workflows.
- `operator`: fleet/shift visibility, shift entry, incident reporting and turf issue workflows.

## F&B inventory linkage

Posting an F&B receipt updates the outstanding order and receipt ledger in one Firestore transaction and increments the matching shared Inventory Master SKU. If no eligible matching item exists, an `F&B` inventory item is created. A unit mismatch blocks receipt posting rather than mixing kilograms with litres or pieces. The latest positive received rate updates inventory unit cost; an empty/zero rate does not erase an existing rate.

## Important

The app's Firebase web configuration and initial administrator role are project-specific setup steps that cannot safely be guessed or completed from this repository. Do not deploy the new Firestore rules until you have verified the role seed and intended project. Once deployed, unsigned clients are denied access to the protected operational collections.
