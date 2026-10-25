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
