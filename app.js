const DEFAULT_TOTAL_COUPONS = 3000;
const STORAGE_KEY = "coupon-seva-tracker-v1";
const AUTH_KEY = "coupon-seva-session-v1";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const SEVA_TYPES = [
  "Deepa Seva",
  "Chenetha Seva",
  "Sumangala Subhadram",
  "Panchopachara Seva",
  "General Donation",
  "Prasadam Donation",
  "Donation in Kind"
];

const state = loadState();
let session = loadSession();
let activeDevoteeTab = "pending";
let activeAdminTab = "dashboard";
let isEditing = false;
const els = {};

window.addEventListener("load", () => {
  cacheElements();
  bindEvents();
  render();
document.addEventListener("focusin", (e) => {
  if (e.target.matches("input, textarea, select")) {
    isEditing = true;
  }
});

document.addEventListener("focusout", (e) => {
  if (e.target.matches("input, textarea, select")) {
    isEditing = false;
  }
});
  // Wait until Firebase function exists
  const waitFirebase = setInterval(() => {
    if (typeof initFirebaseSync === "function") {
      clearInterval(waitFirebase);
      initFirebaseSync();
    }
  }, 200);
});
function defaultState(totalCoupons = DEFAULT_TOTAL_COUPONS) {
  return {
    settings: {
      adminPassword: DEFAULT_ADMIN_PASSWORD,
      totalCoupons
    },
    devotees: [],
    coupons: makeCoupons(totalCoupons)
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultState();
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.devotees) || !Array.isArray(parsed.coupons)) {
      return defaultState();
    }

    const totalCoupons = positiveInteger(parsed.settings?.totalCoupons) || parsed.coupons.length || DEFAULT_TOTAL_COUPONS;
    const coupons = normalizeCoupons(parsed.coupons, totalCoupons);

    return {
      settings: {
        adminPassword: parsed.settings?.adminPassword || DEFAULT_ADMIN_PASSWORD,
        totalCoupons
      },
      devotees: parsed.devotees.map((devotee) => ({
        id: devotee.id,
        name: devotee.name || "",
        contact: devotee.contact || "",
        pin: devotee.pin || generatePin()
      })),
      coupons
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(nextSession) {
  session = nextSession;
  if (nextSession) {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(nextSession));
  } else {
    sessionStorage.removeItem(AUTH_KEY);
  }
}

function cacheElements() {
  [
    "loginScreen", "loginForm", "loginRole", "loginDevoteeLabel", "loginDevotee", "loginPassword", "couponSubtitle",
    "logoutBtn", "userBadge", "csvBtn", "exportBtn", "importFile", "totalCoupons", "assignedCoupons", "soldCoupons", "moneyReceived", "settledCoupons",
    "devoteeForm", "devoteeName", "devoteeContact", "assignForm", "assignDevotee", "assignFrom",
    "assignTo", "assignHint", "couponSettingsForm", "totalCouponInput", "resetCouponForm", "resetCouponNumber", "resetDevotee", "resetCouponList",
    "selectAllResetCouponsBtn", "clearResetSelectionBtn", "resetSelectedCouponsBtn", "resetDevoteeCouponsBtn", "resetAllCouponsBtn",
    "adminPasswordForm", "adminPassword", "adminPeriodSummary", "devoteeSearch", "settledFromDate", "settledToDate", "devoteeList", "entryDevotee", "devoteeStats", "entrySearch",
    "entryStatus", "entryList", "allSearch", "allStatus", "allCouponsBody", "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.view).classList.add("active");
      render();
    });
  });

  els.loginForm.addEventListener("submit", login);
  els.loginRole.addEventListener("change", renderLoginRole);
  els.logoutBtn.addEventListener("click", logout);
  els.devoteeForm.addEventListener("submit", addDevotee);
  els.assignForm.addEventListener("submit", assignCoupons);
  els.couponSettingsForm.addEventListener("submit", updateTotalCoupons);
  els.resetCouponForm.addEventListener("submit", resetOneCoupon);
  els.resetDevotee.addEventListener("change", renderResetCouponList);
  els.selectAllResetCouponsBtn.addEventListener("click", selectAllResetCoupons);
  els.clearResetSelectionBtn.addEventListener("click", clearResetSelection);
  els.resetSelectedCouponsBtn.addEventListener("click", resetSelectedCoupons);
  els.resetDevoteeCouponsBtn.addEventListener("click", resetDevoteeCoupons);
  els.resetAllCouponsBtn.addEventListener("click", resetAllCoupons);
  els.adminPasswordForm.addEventListener("submit", updateAdminPassword);
  els.devoteeSearch.addEventListener("input", renderDevotees);
  els.settledFromDate.addEventListener("change", renderDevotees);
  els.settledToDate.addEventListener("change", renderDevotees);
  els.entryDevotee.addEventListener("change", renderEntryList);
  els.entrySearch.addEventListener("input", renderEntryList);
  els.entryStatus.addEventListener("change", renderEntryList);
  els.allSearch.addEventListener("input", renderAllCoupons);
  els.allStatus.addEventListener("change", renderAllCoupons);
  els.exportBtn.addEventListener("click", exportBackup);
  els.csvBtn.addEventListener("click", exportCsv);
  els.importFile.addEventListener("change", importBackup);

  document.querySelectorAll("[data-devotee-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeDevoteeTab = tab.dataset.devoteeTab;
      document.querySelectorAll("[data-devotee-tab]").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      renderEntryList();
    });
  });

  document.querySelectorAll("[data-admin-tab]").forEach(tab => {
  tab.addEventListener("click", () => {
    activeAdminTab = tab.dataset.adminTab;

    document.querySelectorAll("[data-admin-tab]").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    updateAdminView();
  });
});
  
}

function login(event) {
  event.preventDefault();
  const role = els.loginRole.value;
  const password = els.loginPassword.value.trim();

  if (role === "admin") {
    if (password !== state.settings.adminPassword) {
      showToast("Admin password is incorrect");
      return;
    }
    saveSession({ role: "admin", devoteeId: "" });
  } else {
    const devotee = state.devotees.find((item) => item.id === els.loginDevotee.value);
    if (!devotee || password !== devotee.pin) {
      showToast("Devotee PIN is incorrect");
      return;
    }
    saveSession({ role: "devotee", devoteeId: devotee.id });
  }

  els.loginForm.reset();
