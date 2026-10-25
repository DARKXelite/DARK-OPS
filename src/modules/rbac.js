export const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(["*"]),
  manager: Object.freeze([
    "dashboard.read", "fleet.read", "fleet.write", "fuel.read", "fuel.write",
    "shifts.read", "shifts.write", "turf.read", "turf.write", "turf.issue",
    "inventory.read", "inventory.write", "expenses.read", "expenses.write",
    "reports.read", "users.read", "users.manage", "fnb.read", "fnb.write", "fnb.receive", "fnb.delete", "fuel.delete", "shifts.delete", "incidents.write", "incidents.delete",
    "maintenance.read", "maintenance.write", "assignments.read", "assignments.write"
  ]),
  storekeeper: Object.freeze([
    "dashboard.read", "fuel.read", "fuel.write", "turf.read", "turf.issue",
    "inventory.read", "inventory.write", "expenses.read", "reports.read",
    "fnb.read", "fnb.write", "fnb.receive"
  ]),
  operator: Object.freeze([
    "dashboard.read", "fleet.read", "shifts.read", "shifts.write",
    "turf.read", "turf.issue", "incidents.write", "inventory.read",
    "maintenance.read", "assignments.read"
  ])
});

export const ROLE_LABELS = Object.freeze({
  admin: "Administrator",
  manager: "Operations manager",
  storekeeper: "Storekeeper",
  operator: "Field operator"
});

export function canRole(role, permission) {
  const grants = ROLE_PERMISSIONS[role] || [];
  return grants.includes("*") || grants.includes(permission);
}

export function permissionForView(view) {
  if (view === "overview") return "dashboard.read";
  if (view === "fleet" || view === "radar" || view === "zones" || view === "shifts" || view === "records") return "fleet.read";
  if (view === "fuel") return "fuel.read";
  if (view === "registry") return "inventory.read";
  if (view === "expenses") return "expenses.read";
  if (view === "users") return "users.read";
  if (view === "turfcare") return "turf.read";
  if (view === "fnb") return "fnb.read";
  return "dashboard.read";
}

export function permissionForCollection(collectionName, write = false) {
  const readMap = {
    users: "users.read", machines: "fleet.read", fuel_logs: "fuel.read",
    shifts: "shifts.read", CourseZones: "fleet.read", live_telemetry: "fleet.read",
    inventory: "inventory.read", logs: "fleet.read", maintenance_logs: "maintenance.read",
    assignment_logs: "assignments.read", turf_plans: "turf.read",
    store_inwards: "inventory.read", local_expenses: "expenses.read",
    fnb_orders: "fnb.read", fnb_receipts: "fnb.read", app_roles: "access.manage"
  };
  const writeMap = {
    users: "users.manage", machines: "fleet.write", fuel_logs: "fuel.write",
    shifts: "shifts.write", CourseZones: "fleet.write", live_telemetry: "fleet.write",
    inventory: "inventory.write", logs: "incidents.write", maintenance_logs: "maintenance.write",
    assignment_logs: "assignments.write", turf_plans: "turf.write",
    store_inwards: "inventory.write", local_expenses: "expenses.write",
    fnb_orders: "fnb.write", fnb_receipts: "fnb.receive", app_roles: "access.manage"
  };
  return (write ? writeMap : readMap)[collectionName] || "admin.only";
}

const ACTION_PERMISSIONS = {
  "fnb-tab": "fnb.read", "fnb-save-order": "fnb.write",
  "fnb-import-orders": "fnb.write", "fnb-clear-import": "fnb.write", "fnb-receive": "fnb.receive",
  "open-role-admin": "access.manage",
  "add-machine": "fleet.write", "edit-machine": "fleet.write", "svc-done": "fleet.write",
  "open-fuel": "fuel.write", "open-run": "shifts.write", "add-spray": "turf.write",
  "save-turf-batch": "turf.write", "open-planner": "turf.write", "save-turf-plan": "turf.write",
  "tp-save-app": "turf.write", "tp-del-app": "turf.write", "add-inward": "inventory.write",
  "add-part": "inventory.write", "edit-part": "inventory.write", "stock": "inventory.write",
  "open-store-records": "inventory.write", "store-records-tab": "inventory.write",
  "store-delete-item": "inventory.write", "store-delete-inward": "inventory.write",
  "add-local-expense": "expenses.write", "delete-local-expense": "expenses.write",
  "edit-user": "users.manage", "add-user": "users.manage", "open-data-reset": "admin.only",
  "add-inc": "incidents.write", "inc-toggle": "maintenance.write",
  "save-turf-variance": "turf.write"
};

export function permissionForAction(action, data = {}) {
  if (action === "del") {
    const deletePermissions = {
      fuel: "fuel.delete", fuel_logs: "fuel.delete",
      shifts: "shifts.delete", logs: "incidents.delete",
      fnbOrders: "fnb.delete", fnb_orders: "fnb.delete", fnbReceipts: "fnb.delete", fnb_receipts: "fnb.delete",
      zones: "fleet.write", CourseZones: "fleet.write", machines: "fleet.write",
      inventory: "inventory.write", inwards: "inventory.write", store_inwards: "inventory.write",
      expenses: "expenses.write", local_expenses: "expenses.write",
      users: "users.manage", maintenance: "maintenance.write", maintenance_logs: "maintenance.write",
      assignments: "assignments.write", assignment_logs: "assignments.write"
    };
    return deletePermissions[data.col] || permissionForCollection(data.col, true);
  }
  if (ACTION_PERMISSIONS[action]) return ACTION_PERMISSIONS[action];
  if (/^export-/.test(action)) return "reports.read";
  if (/^(nav-|group-tab|map-mode|home-insights|dock|kpi-|weather-outlook)/.test(action)) return null;
  if (/^(rpreset|fcat|ffuel|fleetsort|rec-tab|turf-tab|turf-app-|turf-product-|users-search|users-role-filter|exp-filter|store-records-tab)/.test(action)) return null;
  return null;
}
