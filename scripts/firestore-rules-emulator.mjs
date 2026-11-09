import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";

const PROJECT_ID = "demo-clover-greens-ops";
const OWNER_UID = "C1l8ArB3GlSaAQr6iw4O9RKGGik1";
let testEnv;

const orderData = overrides => ({
  itemName: "Tea",
  category: "Other",
  supplier: "Sample Supplier",
  orderDate: "2026-10-25",
  orderedQty: 10,
  receivedQty: 0,
  unit: "Nos",
  expectedRate: 5,
  notes: "",
  status: "Pending",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(...records) {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [path, data] of records) {
      const [collectionName, id] = path.split("/");
      await setDoc(doc(db, collectionName, id), data);
    }
  });
}

const role = (name, active = true) => ({
  role: name,
  active,
  displayName: name + " test",
  updatedBy: "test-seed",
  updatedAt: new Date()
});

test("unauthenticated users cannot read operational data", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "inventory", "item-1")));
  await assertFails(getDoc(doc(db, "machines", "machine-1")));
});

test("only the exact owner UID can bootstrap its own first admin role", async () => {
  const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "app_roles", OWNER_UID), {
    role: "admin",
    active: true,
    displayName: "DARKX Administrator",
    updatedAt: serverTimestamp(),
    updatedBy: OWNER_UID
  }));

  const intruderDb = testEnv.authenticatedContext("intruder-user").firestore();
  await assertFails(setDoc(doc(intruderDb, "app_roles", "intruder-user"), {
    role: "admin",
    active: true,
    displayName: "Unapproved admin",
    updatedAt: serverTimestamp(),
    updatedBy: "intruder-user"
  }));
});

test("missing or explicitly disabled roles cannot read protected data", async () => {
  await seed(
    ["app_roles/disabled-user", role("operator", false)],
    ["machines/machine-1", { assetName: "Utility Cart", status: "Active" }]
  );
  const disabledDb = testEnv.authenticatedContext("disabled-user").firestore();
  const missingDb = testEnv.authenticatedContext("no-role-user").firestore();
  await assertFails(getDoc(doc(disabledDb, "machines", "machine-1")));
  await assertFails(getDoc(doc(missingDb, "machines", "machine-1")));
});

test("platform-linked identity is restricted to its assigned modules and own profile", async () => {
  await seed(
    ["users/android-staff-1", {
      fullName: "Android Operator",
      mobileNumber: "+919876543210",
      platform: "android",
      platformRole: "operator",
      moduleAccess: ["inventory"],
      status: "active",
      authUid: "android-user-1"
    }],
    ["app_roles/android-user-1", {
      ...role("operator"),
      platform: "android",
      staffProfileId: "android-staff-1",
      platformRole: "operator",
      moduleAccess: ["inventory"]
    }],
    ["inventory/item-1", { partName: "Sand", stockQuantity: 10 }],
    ["machines/machine-1", { assetName: "Utility Cart", status: "Active" }],
    ["users/other-staff", { fullName: "Other Staff", authUid: "someone-else", platform: "android", status: "active" }]
  );
  const db = testEnv.authenticatedContext("android-user-1").firestore();
  await assertSucceeds(getDoc(doc(db, "inventory", "item-1")));
  await assertFails(getDoc(doc(db, "machines", "machine-1")));
  await assertSucceeds(getDoc(doc(db, "users", "android-staff-1")));
  await assertFails(getDoc(doc(db, "users", "other-staff")));
});


test("Android role modules gate Breakfast, Golf and Workshop collections independently", async () => {
  await seed(
    ["users/captain-staff", {
      fullName: "Captain",
      mobileNumber: "+919876543213",
      platform: "android",
      platformRole: "captain",
      moduleAccess: ["breakfast_qr"],
      status: "active",
      authUid: "captain-user"
    }],
    ["app_roles/captain-user", {
      ...role("operator"),
      platform: "android",
      staffProfileId: "captain-staff",
      platformRole: "captain",
      moduleAccess: ["breakfast_qr"]
    }],
    ["breakfast_entitlements/entitlement-1", { status: "active", guestCount: 1 }],
    ["golf_passes/pass-1", { status: "active" }],
    ["users/marshal-staff", {
      fullName: "Marshal",
      mobileNumber: "+919876543214",
      platform: "android",
      platformRole: "marshal",
      moduleAccess: ["golf_qr"],
      status: "active",
      authUid: "marshal-user"
    }],
    ["app_roles/marshal-user", {
      ...role("operator"),
      platform: "android",
      staffProfileId: "marshal-staff",
      platformRole: "marshal",
      moduleAccess: ["golf_qr"]
    }],
    ["users/workshop-staff", {
      fullName: "Workshop Manager",
      mobileNumber: "+919876543215",
      platform: "android",
      platformRole: "workshop_manager",
      moduleAccess: ["workshop_ops"],
      status: "active",
      authUid: "workshop-user"
    }],
    ["app_roles/workshop-user", {
      ...role("operator"),
      platform: "android",
      staffProfileId: "workshop-staff",
      platformRole: "workshop_manager",
      moduleAccess: ["workshop_ops"]
    }],
    ["maintenance_logs/maintenance-1", { status: "Open" }]
  );
  const captainDb = testEnv.authenticatedContext("captain-user").firestore();
  const marshalDb = testEnv.authenticatedContext("marshal-user").firestore();
  const workshopDb = testEnv.authenticatedContext("workshop-user").firestore();
  await assertSucceeds(getDoc(doc(captainDb, "breakfast_entitlements", "entitlement-1")));
  await assertFails(getDoc(doc(captainDb, "golf_passes", "pass-1")));
  await assertSucceeds(getDoc(doc(marshalDb, "golf_passes", "pass-1")));
  await assertFails(getDoc(doc(marshalDb, "breakfast_entitlements", "entitlement-1")));
  await assertSucceeds(updateDoc(doc(workshopDb, "maintenance_logs", "maintenance-1"), { status: "Serviced" }));
  await assertFails(getDoc(doc(workshopDb, "machines", "machine-1")));
});

test("platform activation secrets and client-side platform role provisioning are denied", async () => {
  await seed(
    ["app_roles/admin-user", role("admin")],
    ["android_invites/staff-1", { codeHash: "private-hash" }]
  );
  const adminDb = testEnv.authenticatedContext("admin-user").firestore();
  await assertFails(getDoc(doc(adminDb, "android_invites", "staff-1")));
  await assertFails(setDoc(doc(adminDb, "app_roles", "platform-user"), {
    role: "operator",
    active: true,
    platform: "android",
    staffProfileId: "staff-1",
    platformRole: "operator",
    moduleAccess: ["inventory"],
    updatedAt: serverTimestamp(),
    updatedBy: "admin-user"
  }));
});

test("platform identity is denied when profile is suspended or grants do not match", async () => {
  await seed(
    ["users/suspended-staff", {
      fullName: "Suspended Operator",
      mobileNumber: "+919876543211",
      platform: "android",
      platformRole: "operator",
      moduleAccess: ["inventory"],
      status: "suspended",
      authUid: "suspended-user"
    }],
    ["app_roles/suspended-user", {
      ...role("operator"),
      platform: "android",
      staffProfileId: "suspended-staff",
      platformRole: "operator",
      moduleAccess: ["inventory"]
    }],
    ["users/mismatched-staff", {
      fullName: "Mismatched Operator",
      mobileNumber: "+919876543212",
      platform: "android",
      platformRole: "operator",
      moduleAccess: ["fleet_ops"],
      status: "active",
      authUid: "mismatched-user"
    }],
    ["app_roles/mismatched-user", {
      ...role("operator"),
      platform: "android",
      staffProfileId: "mismatched-staff",
      platformRole: "operator",
      moduleAccess: ["inventory"]
    }],
    ["inventory/item-1", { partName: "Sand", stockQuantity: 10 }]
  );
  const suspendedDb = testEnv.authenticatedContext("suspended-user").firestore();
  const mismatchedDb = testEnv.authenticatedContext("mismatched-user").firestore();
  await assertFails(getDoc(doc(suspendedDb, "inventory", "item-1")));
  await assertFails(getDoc(doc(mismatchedDb, "inventory", "item-1")));
});


test("operators can only decrease stock and cannot edit machine master data", async () => {
  await seed(
    ["app_roles/operator-1", role("operator")],
    ["inventory/item-1", { partName: "Sand", category: "Supplies", unit: "Bag", stockQuantity: 10, unitCost: 4, reorderLevel: 1 }],
    ["machines/machine-1", { assetName: "Utility Cart", status: "Active", currentHours: 120 }]
  );
  const db = testEnv.authenticatedContext("operator-1").firestore();
  await assertSucceeds(updateDoc(doc(db, "inventory", "item-1"), {
    stockQuantity: 9,
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(db, "inventory", "item-1"), {
    stockQuantity: 11,
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(db, "machines", "machine-1"), { currentHours: 999 }));
});

test("F&B order creation rejects invalid quantities and unexpected fields", async () => {
  await seed(["app_roles/storekeeper-1", role("storekeeper")]);
  const db = testEnv.authenticatedContext("storekeeper-1").firestore();

  await assertSucceeds(setDoc(doc(db, "fnb_orders", "valid-order"), orderData({
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })));
  await assertFails(setDoc(doc(db, "fnb_orders", "zero-quantity"), orderData({
    orderedQty: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })));
  await assertFails(setDoc(doc(db, "fnb_orders", "extra-field"), {
    ...orderData({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    admin: true
  }));
});

test("F&B receipt, stock inward, and order balance must commit together", async () => {
  await seed(
    ["app_roles/storekeeper-1", role("storekeeper")],
    ["app_roles/manager-1", role("manager")],
    ["fnb_orders/order-1", orderData()]
  );
  const db = testEnv.authenticatedContext("storekeeper-1").firestore();
  const orderRef = doc(db, "fnb_orders", "order-1");
  const receiptRef = doc(collection(db, "fnb_receipts"));
  const inwardRef = doc(collection(db, "store_inwards"));
  const inventoryRef = doc(collection(db, "inventory"));
  const quantity = 4;
  const rate = 5;

  await assertSucceeds(runTransaction(db, async tx => {
    const orderSnap = await tx.get(orderRef);
    assert.ok(orderSnap.exists());
    const current = orderSnap.data();
    const receivedQty = current.receivedQty + quantity;

    tx.set(inventoryRef, {
      partName: current.itemName,
      category: "F&B",
      domain: "F&B",
      stockQuantity: quantity,
      lastReceiptId: receiptRef.id,
      unit: current.unit,
      unitCost: rate,
      reorderLevel: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    tx.set(receiptRef, {
      orderId: orderRef.id,
      itemId: inventoryRef.id,
      itemName: current.itemName,
      category: current.category,
      supplier: current.supplier,
      unit: current.unit,
      quantity,
      rate,
      receiptDate: "2026-10-25",
      createdAt: serverTimestamp(),
      transactionType: "FNB_RECEIPT",
      inwardId: inwardRef.id
    });
    tx.set(inwardRef, {
      itemId: inventoryRef.id,
      itemName: current.itemName,
      category: "F&B",
      fnbCategory: current.category,
      unit: current.unit,
      quantity,
      rate,
      gstPercent: 0,
      taxableAmount: quantity * rate,
      gstAmount: 0,
      total: quantity * rate,
      supplier: current.supplier,
      invoiceNumber: "FNB-" + receiptRef.id,
      receiptDate: "2026-10-25",
      notes: "F&B order " + orderRef.id,
      transactionType: "FNB_RECEIPT",
      fnbOrderId: orderRef.id,
      fnbReceiptId: receiptRef.id,
      createdAt: serverTimestamp()
    });
    tx.update(orderRef, {
      receivedQty,
      status: receivedQty >= current.orderedQty ? "Received" : "Partial",
      lastReceiptId: receiptRef.id,
      updatedAt: serverTimestamp()
    });
  }));

  const updatedOrder = await getDoc(orderRef);
  assert.equal(updatedOrder.data().receivedQty, quantity);
  await assertFails(updateDoc(receiptRef, { quantity: 99 }));
  const managerDb = testEnv.authenticatedContext("manager-1").firestore();
  await assertFails(deleteDoc(doc(managerDb, "fnb_orders", "order-1")));
});

test("an order balance cannot be changed without a matching receipt document", async () => {
  await seed(
    ["app_roles/storekeeper-1", role("storekeeper")],
    ["fnb_orders/order-2", orderData()]
  );
  const db = testEnv.authenticatedContext("storekeeper-1").firestore();
  await assertFails(updateDoc(doc(db, "fnb_orders", "order-2"), {
    receivedQty: 4,
    status: "Partial",
    lastReceiptId: "missing-receipt",
    updatedAt: serverTimestamp()
  }));
});

test("a receipt cannot be posted without its stock inward and inventory balance", async () => {
  await seed(
    ["app_roles/storekeeper-1", role("storekeeper")],
    ["fnb_orders/order-no-stock", orderData()]
  );
  const db = testEnv.authenticatedContext("storekeeper-1").firestore();
  const orderRef = doc(db, "fnb_orders", "order-no-stock");
  const receiptRef = doc(collection(db, "fnb_receipts"));
  await assertFails(runTransaction(db, async tx => {
    const snapshot = await tx.get(orderRef);
    assert.ok(snapshot.exists());
    const order = snapshot.data();
    tx.set(receiptRef, {
      orderId: orderRef.id,
      itemId: "missing-inventory",
      itemName: order.itemName,
      category: order.category,
      supplier: order.supplier,
      unit: order.unit,
      quantity: 2,
      rate: 5,
      receiptDate: "2026-10-25",
      createdAt: serverTimestamp(),
      transactionType: "FNB_RECEIPT",
      inwardId: "missing-inward"
    });
    tx.update(orderRef, {
      receivedQty: 2,
      status: "Partial",
      lastReceiptId: receiptRef.id,
      updatedAt: serverTimestamp()
    });
  }));
});

test("normal inward receipts and inventory increases must post atomically", async () => {
  await seed(
    ["app_roles/storekeeper-1", role("storekeeper")],
    ["inventory/sand-1", { partName: "Sand", category: "Supplies", unit: "Bag", stockQuantity: 5, unitCost: 4, reorderLevel: 1 }]
  );
  const db = testEnv.authenticatedContext("storekeeper-1").firestore();
  const itemRef = doc(db, "inventory", "sand-1");
  const inwardRef = doc(collection(db, "store_inwards"));
  const quantity = 3;
  const rate = 6;

  await assertSucceeds(runTransaction(db, async tx => {
    const itemSnapshot = await tx.get(itemRef);
    const item = itemSnapshot.data();
    tx.update(itemRef, {
      stockQuantity: item.stockQuantity + quantity,
      unitCost: rate,
      lastInwardId: inwardRef.id,
      updatedAt: serverTimestamp()
    });
    tx.set(inwardRef, {
      itemId: itemRef.id,
      itemName: item.partName,
      category: item.category,
      unit: item.unit,
      quantity,
      rate,
      gstPercent: 0,
      taxableAmount: quantity * rate,
      gstAmount: 0,
      total: quantity * rate,
      supplier: "Sample Supplier",
      invoiceNumber: "GRN-001",
      receiptDate: "2026-10-25",
      notes: "",
      createdAt: serverTimestamp(),
      transactionType: "INWARD"
    });
  }));
  assert.equal((await getDoc(itemRef)).data().stockQuantity, 8);

  const invalidInwardRef = doc(collection(db, "store_inwards"));
  await assertFails(setDoc(invalidInwardRef, {
    itemId: itemRef.id,
    itemName: "Sand",
    category: "Supplies",
    unit: "Bag",
    quantity: 2,
    rate: 6,
    gstPercent: 0,
    taxableAmount: 12,
    gstAmount: 0,
    total: 12,
    supplier: "Sample Supplier",
    invoiceNumber: "GRN-002",
    receiptDate: "2026-10-25",
    notes: "",
    createdAt: serverTimestamp(),
    transactionType: "INWARD"
  }));
});


test("one room QR can redeem one guest per scan up to the room guest count", async () => {
  const passId = "a".repeat(64);
  const bookingId = "room-booking-1";
  const validDate = "2026-11-07";
  await seed(
    ["app_roles/manager-1", role("manager")],
    ["app_roles/storekeeper-1", role("storekeeper")]
  );
  const managerDb = testEnv.authenticatedContext("manager-1").firestore();
  await assertSucceeds(setDoc(doc(managerDb, "breakfast_bookings", bookingId), {
    bookingRef: "CG-ROOM-001",
    guestName: "Lead Guest",
    roomNumber: "204",
    guestPhone: "+919876543210",
    guestCount: 2,
    checkIn: "2026-11-06",
    checkOut: "2026-11-08",
    checkInAt: "2026-11-06T14:00",
    checkOutAt: "2026-11-08T11:00",
    serviceWindowStart: "07:00",
    serviceWindowEnd: "10:00",
    breakfastDates: [validDate],
    couponCount: 1,
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: "manager-1"
  }));
  await assertSucceeds(setDoc(doc(managerDb, "breakfast_entitlements", passId), {
    id: passId,
    bookingId,
    bookingRef: "CG-ROOM-001",
    guestName: "Lead Guest",
    roomNumber: "204",
    guestPhone: "+919876543210",
    guestCount: 2,
    checkInAt: "2026-11-06T14:00",
    checkOutAt: "2026-11-08T11:00",
    breakfastDates: [validDate],
    serviceWindowStart: "07:00",
    serviceWindowEnd: "10:00",
    status: "active",
    qrToken: "x".repeat(43),
    createdAt: serverTimestamp(),
    createdBy: "manager-1"
  }));

  const staffDb = testEnv.authenticatedContext("storekeeper-1").firestore();
  const redemptionRef = doc(staffDb, "breakfast_redemptions", passId + "_" + validDate);
  const base = {
    passId,
    bookingId,
    bookingRef: "CG-ROOM-001",
    roomNumber: "204",
    guestName: "Lead Guest",
    guestCount: 2,
    validDate,
    serviceWindowStart: "07:00",
    serviceWindowEnd: "10:00"
  };
  await assertSucceeds(runTransaction(staffDb, async tx => {
    tx.set(redemptionRef, {
      ...base,
      redeemedCount: 1,
      redeemedAt: serverTimestamp(),
      redeemedBy: "storekeeper-1",
      lastRedeemedAt: serverTimestamp(),
      lastRedeemedBy: "storekeeper-1"
    });
  }));
  await assertSucceeds(runTransaction(staffDb, async tx => {
    const current = await tx.get(redemptionRef);
    tx.update(redemptionRef, {
      redeemedCount: current.data().redeemedCount + 1,
      lastRedeemedAt: serverTimestamp(),
      lastRedeemedBy: "storekeeper-1"
    });
  }));
  await assertFails(runTransaction(staffDb, async tx => {
    const current = await tx.get(redemptionRef);
    tx.update(redemptionRef, {
      redeemedCount: current.data().redeemedCount + 1,
      lastRedeemedAt: serverTimestamp(),
      lastRedeemedBy: "storekeeper-1"
    });
  }));
});
