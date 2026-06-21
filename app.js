const DEFAULT_TOTAL_COUPONS = 3000;
const STORAGE_KEY = "coupon-seva-tracker-v1";
const AUTH_KEY = "coupon-seva-session-v1";
const DEFAULT_ADMIN_PASSWORD = "hare krishna";
const APP_URL = "https://vikram34it.github.io/coupons-tracker/";
const SHEET_SYNC_DEBOUNCE_MS = 2000;
const SHEET_HOURLY_SYNC_MS = 60 * 60 * 1000;

const state = loadState();
let session = loadSession();
let activeDevoteeTab = "pending";
let activeAdminTab = "dashboard";
let isEditing = false;
let pendingFirebaseData = null;
const pendingLocalCouponNumbers = new Set();
let saveTimer = null;
let sheetSyncTimer = null;
let sheetHourlyTimer = null;
let sheetHourlyConfigKey = "";
let firebaseHasLoaded = false;
let firebaseCanWrite = false;
let pendingFirebaseWrite = false;
let lastEditTime = 0;           // ✅ FIX: timestamp of last coupon field edit
const EDIT_GUARD_MS = 3000;    // ✅ FIX: ignore Firebase echoes for 3s after editing
const els = {};
const SEVA_TYPES = [
  "Deepa Seva",
  "Chenetha Seva",
  "Sumangala Subhadram",
  "Panchopachara Seva",
  "General Donation",
  "Prasadam Donation",
  "Donation in Kind"
];

window.addEventListener("load", () => {
  cacheElements();
  bindEvents();
  renderSelectors(); // ✅ ADD THIS
  render();
  configureHourlySheetSync();

  // ✅ FIX: Show loading hint on login screen while Firebase connects
  updateLoginSyncHint("loading");

  document.addEventListener("focusin", (e) => {
    if (e.target.matches("input, textarea, select")) {
      isEditing = true;
    }
  });

  document.addEventListener("focusout", (e) => {
    if (e.target.matches("input, textarea, select")) {

      // ⏳ Delay to allow next field focus (TAB FIX)
      setTimeout(() => {
        const active = document.activeElement;

        // ✅ If still inside input → DO NOTHING
        if (active && active.matches("input, textarea, select")) {
          return;
        }

        // ✅ Only now apply Firebase update
        isEditing = false;
        applyPendingFirebaseData();

      }, 100); // small delay is KEY
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

// ✅ FIX: Show sync status hint on login screen to inform users
function updateLoginSyncHint(status) {
  let hint = document.getElementById("loginSyncHint");
  if (!hint) {
    hint = document.createElement("p");
    hint.id = "loginSyncHint";
    hint.className = "hint";
    hint.style.cssText = "margin-top:8px; font-size:12px; text-align:center;";
    const loginCard = document.getElementById("loginForm");
    if (loginCard) loginCard.appendChild(hint);
  }
  if (status === "loading") {
    hint.textContent = "⏳ Loading devotee list from server...";
    hint.style.color = "#888";
  } else if (status === "ready") {
    hint.textContent = "✅ Devotee list loaded. Please select your name.";
    hint.style.color = "#1e7a45";
    setTimeout(() => { hint.textContent = ""; }, 4000);
  } else if (status === "local") {
    hint.textContent = "";
  }
}
function defaultState(totalCoupons = DEFAULT_TOTAL_COUPONS) {
  return {
    settings: {
      adminPassword: DEFAULT_ADMIN_PASSWORD,
      totalCoupons,
      invitationMessage: "",
      viewerPassword: "",
      sheetAutoUpdate: false,
      sheetHourlyUpdate: false,
      sheetWebhookUrl: "",
      autoReceipt: false
    },
    devotees: [],
    coupons: makeCoupons(totalCoupons),
    hundi: []
  };
}

function normalizeSettings(settings = {}, fallbackTotal = DEFAULT_TOTAL_COUPONS) {
  return {
    adminPassword: settings.adminPassword || DEFAULT_ADMIN_PASSWORD,
    totalCoupons: positiveInteger(settings.totalCoupons) || fallbackTotal || DEFAULT_TOTAL_COUPONS,
    invitationMessage: settings.invitationMessage || "",
    viewerPassword: settings.viewerPassword || "",
    sheetAutoUpdate: Boolean(settings.sheetAutoUpdate),
    sheetHourlyUpdate: Boolean(settings.sheetHourlyUpdate),
    sheetWebhookUrl: settings.sheetWebhookUrl || "",
    autoReceipt: Boolean(settings.autoReceipt)
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
      settings: normalizeSettings(parsed.settings, totalCoupons),
      devotees: parsed.devotees.map(normalizeDevotee),
      coupons,
      hundi: Array.isArray(parsed.hundi) ? parsed.hundi.map(h => ({ settled: false, ...h })) : []
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function queueStateSave(delay = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveQueuedLocalEdits();
  }, delay);
}

function flushQueuedStateSave() {
  if (!saveTimer) return false;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveQueuedLocalEdits();
  return true;
}

function saveQueuedLocalEdits() {
  if (pendingFirebaseData) {
    const data = pendingFirebaseData;
    const preserveCouponNumbers = new Set(pendingLocalCouponNumbers);
    pendingFirebaseData = null;
    applyFirebaseData(data, { preserveCouponNumbers, skipRender: true });
  }

  pendingLocalCouponNumbers.clear();
  saveState();
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

function renderSevaSummary() {
  const period = settlementPeriod();

  const sevaMap = {};
  SEVA_TYPES.forEach(s => { sevaMap[s] = { count: 0, amount: 0 }; });
  sevaMap["Hundi Donation"] = { count: 0, amount: 0 };

  state.coupons
    .filter(c => c.settled && inSettlementPeriod(c, period))
    .forEach(coupon => {
      const seva = coupon.description || "Others";
      if (!sevaMap[seva]) sevaMap[seva] = { count: 0, amount: 0 };
      sevaMap[seva].count += 1;
      sevaMap[seva].amount += amountValue(coupon.amount);
    });

  (state.hundi || []).filter(h => h.settled).forEach(h => {
    const seva = "Hundi Donation";
    if (!sevaMap[seva]) sevaMap[seva] = { count: 0, amount: 0 };
    sevaMap[seva].count += 1;
    sevaMap[seva].amount += h.amount;
  });
  const rows = Object.entries(sevaMap)
    .sort((a, b) => b[1].amount - a[1].amount) // sort by amount
    .map(([seva, data]) => `
      <tr>
        <td>${escapeHtml(seva)}</td>
        <td>${data.count}</td>
        <td>${formatMoney(data.amount)}</td>
      </tr>
    `)
    .join("");

  els.sevaSummary.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Seva</th>
            <th>Count</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="3">No data</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function cacheElements() {
  [
    "loginScreen", "loginForm", "loginRole", "loginDevoteeLabel", "loginDevotee", "loginPassword", "couponSubtitle",
    "logoutBtn", "userBadge", "syncBadge", "darkToggle", "langToggle", "printViewBtn", "scrollTopBtn", "csvBtn", "exportBtn", "importFile", "totalCoupons", "assignedCoupons", "soldCoupons", "couponSettledMoney", "hundiSettledMoney", "moneyReceived", "settledCoupons", "unsettledMoney", "templeTransferMoney", "cashTotalMoney",
    "devoteeForm", "devoteeName", "devoteeContact", "devoteePassword", "devoteeCanCheckin", "assignForm", "assignDevotee", "assignFrom",
    "assignTo", "assignDate", "assignSendWhatsapp", "assignHint",     "couponSettingsForm", "totalCouponInput", "autoReceiptCheck", "resetCouponForm", "resetCouponNumber", "resetDevotee", "resetCouponList",
    "selectAllResetCouponsBtn", "clearResetSelectionBtn", "resetSelectedCouponsBtn", "resetDevoteeCouponsBtn", "resetAllCouponsBtn",
    "adminPasswordForm", "adminPassword", "viewerPasswordForm", "viewerPasswordInput", "sheetSyncForm", "sheetAutoUpdate", "sheetHourlyUpdate", "sheetWebhookUrl", "sheetSyncNowBtn", "sheetSyncStatus",
    "invitationForm", "invitationMessageInput", "previewInvitationBtn", "invitationSavedBadge",
    "adminPeriodSummary", "devoteeSearch", "devoteeStatusFilter", "dashboardDevoteeFilter", "settledFromDate", "settledToDate", "devoteeList", "sevaChart", "trendChart", "perfChart", "auditLog", "entryDevotee", "devoteeStats", "entrySearch",
    "entryStatus", "entryList", "allSearch", "allStatus", "allSevaFilter", "allPaymentFilter", "allDevoteeFilter",     "allCouponCount", "devoteePendingDisplay", "sevaSummary", "allCouponsBody", "allPagination", "bulkWhatsAppBtn", "bulkPdfBtn", "toast",
    "checkinInput", "checkinBtn", "checkinUndoBtn", "checkinResult", "checkinTotalSold", "checkinCheckedIn", "checkinPending",
    "checkinDevoteeFilter", "checkinSevaFilter", "checkinStatusFilter", "checkinSearch", "checkinCount", "checkinReportBody", "checkinPrintBtn",
    "checkinActionHeader"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}


function updateDevoteePendingDisplay() {
  if (!els.devoteePendingDisplay || !els.allDevoteeFilter) return;

  const devoteeId = els.allDevoteeFilter.value;

  if (!devoteeId || devoteeId === "all") {
    els.devoteePendingDisplay.textContent = "";
    return;
  }

  const pendingAmount = state.coupons
    .filter(c =>
      c.devoteeId === devoteeId &&
      !c.settled &&
      amountValue(c.amount) > 0   // ✅ THIS IS KEY
    )
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  els.devoteePendingDisplay.textContent =
    `Pending: ${formatMoney(pendingAmount)}`;

  // 🎨 optional color
  els.devoteePendingDisplay.style.color =
    pendingAmount > 0 ? "red" : "green";
}

function renderAllDevoteeFilter() {
  if (!els.allDevoteeFilter) return;

  // ✅ Preserve current selection before rebuilding
  const currentValue = els.allDevoteeFilter.value;

  const sorted = [...state.devotees].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const options = [
    `<option value="all">All Devotees</option>`,
    ...sorted.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
  ];

  els.allDevoteeFilter.innerHTML = options.join("");

  // ✅ Restore by setting value directly — works even with UUIDs
  if (currentValue) {
    els.allDevoteeFilter.value = currentValue;
    // If value didn't stick (devotee no longer exists), fall back to "all"
    if (els.allDevoteeFilter.value !== currentValue) {
      els.allDevoteeFilter.value = "all";
    }
  }
}

function renderAllSevaFilter() {
  if (!els.allSevaFilter) return;

  const currentValue = els.allSevaFilter.value;
  const savedSevas = state.coupons
    .map(coupon => (coupon.description || "").trim())
    .filter(Boolean);
  const sevas = [...new Set([...SEVA_TYPES, ...savedSevas])]
    .sort((a, b) => a.localeCompare(b));

  els.allSevaFilter.innerHTML = [
    `<option value="all">All Seva Types</option>`,
    ...sevas.map(seva => `<option value="${escapeAttr(seva)}">${escapeHtml(seva)}</option>`)
  ].join("");

  if (currentValue) {
    els.allSevaFilter.value = currentValue;
    if (els.allSevaFilter.value !== currentValue) {
      els.allSevaFilter.value = "all";
    }
  }
}

function renderDashboardDevoteeFilter() {
  if (!els.dashboardDevoteeFilter) return;

  const currentValue = els.dashboardDevoteeFilter.value;

  const sorted = [...state.devotees].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const options = [
    `<option value="all">All Devotees</option>`,
    ...sorted.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
  ];

  els.dashboardDevoteeFilter.innerHTML = options.join("");

  if (currentValue) {
    els.dashboardDevoteeFilter.value = currentValue;
    if (els.dashboardDevoteeFilter.value !== currentValue) {
      els.dashboardDevoteeFilter.value = "all";
    }
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateView(tab.dataset.view);
      render();
    });
  });

  // Auto-set assign date to today
  if (els.assignDate && !els.assignDate.value) els.assignDate.value = todayKey();

  els.loginForm.addEventListener("submit", login);
  els.loginRole.addEventListener("change", renderLoginRole);
  els.logoutBtn.addEventListener("click", logout);
  els.devoteeForm.addEventListener("submit", addDevotee);
  els.assignForm.addEventListener("submit", assignCoupons);
  els.couponSettingsForm.addEventListener("submit", updateTotalCoupons);
  if (els.autoReceiptCheck) {
    els.autoReceiptCheck.addEventListener("change", () => {
      state.settings.autoReceipt = els.autoReceiptCheck.checked;
      saveState();
    });
  }
  els.resetCouponForm.addEventListener("submit", resetOneCoupon);
  els.resetDevotee.addEventListener("change", renderResetCouponList);
  els.selectAllResetCouponsBtn.addEventListener("click", selectAllResetCoupons);
  els.clearResetSelectionBtn.addEventListener("click", clearResetSelection);
  els.resetSelectedCouponsBtn.addEventListener("click", resetSelectedCoupons);
  els.resetDevoteeCouponsBtn.addEventListener("click", resetDevoteeCoupons);
  els.resetAllCouponsBtn.addEventListener("click", resetAllCoupons);
  els.adminPasswordForm.addEventListener("submit", updateAdminPassword);
  els.viewerPasswordForm.addEventListener("submit", updateViewerPassword);
  els.sheetSyncForm.addEventListener("submit", saveSheetSyncSettings);
  els.sheetSyncNowBtn.addEventListener("click", syncSheetNow);
  els.invitationForm.addEventListener("submit", saveInvitationTemplate);
  els.previewInvitationBtn.addEventListener("click", previewInvitationMessage);
  els.devoteeSearch.addEventListener("input", renderDevotees);
  els.devoteeStatusFilter.addEventListener("change", renderDevotees);
  els.dashboardDevoteeFilter.addEventListener("change", renderDevotees);
  els.settledFromDate.addEventListener("change", renderDevotees);
  els.settledToDate.addEventListener("change", renderDevotees);
  els.entryDevotee.addEventListener("change", renderEntryList);
  els.entrySearch.addEventListener("input", renderEntryList);
  els.entryStatus.addEventListener("change", renderEntryList);
  els.allSearch.addEventListener("input", () => { currentPage = 1; renderAllCoupons(); renderPagination(); });
  els.allStatus.addEventListener("change", () => { currentPage = 1; renderAllCoupons(); renderPagination(); });
  els.allSevaFilter.addEventListener("change", () => { currentPage = 1; renderAllCoupons(); renderPagination(); });
  els.allPaymentFilter.addEventListener("change", () => { currentPage = 1; renderAllCoupons(); renderPagination(); });
  els.exportBtn.addEventListener("click", exportBackup);
  els.csvBtn.addEventListener("click", exportCsv);
  els.importFile.addEventListener("change", importBackup);
  els.darkToggle.addEventListener("click", toggleDarkMode);
  els.langToggle.addEventListener("click", toggleLanguage);
  els.printViewBtn.addEventListener("click", printCouponReport);
  els.scrollTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  els.bulkWhatsAppBtn.addEventListener("click", bulkWhatsApp);
  els.bulkPdfBtn.addEventListener("click", bulkPdfReceipts);
  document.querySelectorAll("[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => applyDatePreset(btn.dataset.preset));
  });
  document.querySelectorAll(".sortable").forEach(th => {
    th.addEventListener("click", () => sortTable(th.dataset.sort));
  });
  window.addEventListener("scroll", () => {
    els.scrollTopBtn.classList.toggle("visible", window.scrollY > 400);
  });
  els.allDevoteeFilter.addEventListener("change", () => {
    currentPage = 1;
    renderAllCoupons();
    renderPagination();
    updateDevoteePendingDisplay();
  });

  els.checkinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCheckin();
  });
  els.checkinBtn.addEventListener("click", handleCheckin);
  els.checkinUndoBtn.addEventListener("click", handleUndoCheckin);
  els.checkinDevoteeFilter.addEventListener("change", renderCheckinReport);
  els.checkinSevaFilter.addEventListener("change", renderCheckinReport);
  els.checkinStatusFilter.addEventListener("change", renderCheckinReport);
  els.checkinSearch.addEventListener("input", renderCheckinReport);
  els.checkinPrintBtn.addEventListener("click", () => window.print());

  document.querySelectorAll("[data-devotee-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeDevoteeTab = tab.dataset.devoteeTab;
      document.querySelectorAll("[data-devotee-tab]").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      render();
    });
  });

  document.querySelectorAll("[data-admin-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
      activeAdminTab = tab.dataset.adminTab;

      document.querySelectorAll("[data-admin-tab]").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      activateView("adminView");
      updateAdminView();
    });
  });

}

function activateView(viewId) {
  document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
  document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
  document.getElementById(viewId)?.classList.add("active");
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
  } else if (role === "viewer") {
    if (!state.settings.viewerPassword) {
      showToast("Viewer password has not been set by admin yet");
      return;
    }
    if (password !== state.settings.viewerPassword) {
      showToast("Viewer password is incorrect");
      return;
    }
    saveSession({ role: "viewer", devoteeId: "" });
  } else {
    const devotee = state.devotees.find((item) => item.id === els.loginDevotee.value);
    if (!devotee || password !== devotee.pin) {
      showToast("Devotee password is incorrect");
      return;
    }
    saveSession({ role: "devotee", devoteeId: devotee.id });
  }

  els.loginForm.reset();
  render();
  addAuditEntry(`${role === "admin" ? "Admin" : role === "viewer" ? "Viewer" : "Devotee"} logged in`);
}

function logout() {
  addAuditEntry("User logged out");
  saveSession(null);
  render();
  showToast("Logged out");
}

function renderLoginRole() {
  const isDevotee = els.loginRole.value === "devotee";
  els.loginDevoteeLabel.classList.toggle("hidden", !isDevotee);
}

function addDevotee(event) {
  event.preventDefault();
  const name = els.devoteeName.value.trim();
  const contact = cleanIndianMobile(els.devoteeContact.value);
  const password = els.devoteePassword.value.trim();
  if (!name) return;
  if (els.devoteeContact.value.trim() && !contact) {
    showToast("Enter valid 10-digit mobile number");
    return;
  }
  if (password.length < 4) {
    showToast("Use at least 4 characters for devotee password");
    return;
  }

  state.devotees.push({
    id: newId(),
    name,
    contact,
    pin: password,
    canCheckin: els.devoteeCanCheckin.checked
  });

  els.devoteeForm.reset();
  saveState();
  render();
  addAuditEntry(`Added devotee: ${name}`);
  showToast("Devotee added");
}

function updateAdminPassword(event) {
  event.preventDefault();
  const password = els.adminPassword.value.trim();
  if (password.length < 4) {
    showToast("Use at least 4 characters");
    return;
  }

  state.settings.adminPassword = password;
  els.adminPasswordForm.reset();
  saveState();
  addAuditEntry("Admin password updated");
  showToast("Admin password updated");
}

function updateViewerPassword(event) {
  event.preventDefault();
  const password = els.viewerPasswordInput.value.trim();
  if (password.length < 4) {
    showToast("Use at least 4 characters for viewer password");
    return;
  }
  state.settings.viewerPassword = password;
  els.viewerPasswordForm.reset();
  saveState();
  showToast("Viewer password set ✓");
}

function saveSheetSyncSettings(event) {
  event.preventDefault();
  const enabled = Boolean(els.sheetAutoUpdate?.checked);
  const hourlyEnabled = Boolean(els.sheetHourlyUpdate?.checked);
  const webhookUrl = normalizeSheetWebhookUrl(els.sheetWebhookUrl?.value || "");

  if ((enabled || hourlyEnabled) && !webhookUrl) {
    showToast("Paste the Google Apps Script Web App URL first");
    return;
  }

  state.settings.sheetAutoUpdate = enabled;
  state.settings.sheetHourlyUpdate = hourlyEnabled;
  state.settings.sheetWebhookUrl = webhookUrl;
  if (els.sheetWebhookUrl) els.sheetWebhookUrl.value = webhookUrl;
  saveState();
  configureHourlySheetSync();
  updateSheetSyncStatus(
    enabled || hourlyEnabled
      ? `Saved. Spreadsheet updates${enabled ? " after coupon changes" : ""}${enabled && hourlyEnabled ? " and" : ""}${hourlyEnabled ? " every 1 hour while open" : ""}.`
      : "Saved. Auto update is off."
  );
  showToast(enabled || hourlyEnabled ? "Google Sheets auto update enabled" : "Google Sheets auto update disabled");
}

function loadSheetSyncSettings() {
  if (els.sheetAutoUpdate) {
    els.sheetAutoUpdate.checked = Boolean(state.settings.sheetAutoUpdate);
  }
  if (els.sheetHourlyUpdate) {
    els.sheetHourlyUpdate.checked = Boolean(state.settings.sheetHourlyUpdate);
  }
  if (els.sheetWebhookUrl) {
    els.sheetWebhookUrl.value = state.settings.sheetWebhookUrl || "";
  }
}

function normalizeSheetWebhookUrl(url) {
  const trimmed = String(url || "").trim();
  return trimmed.replace(/\/dev(\?.*)?$/, "/exec$1");
}

function updateSheetSyncStatus(message) {
  if (els.sheetSyncStatus) {
    els.sheetSyncStatus.textContent = message || "";
  }
}

function syncSheetNow() {
  const webhookUrl = normalizeSheetWebhookUrl(els.sheetWebhookUrl?.value || state.settings.sheetWebhookUrl || "");
  if (!webhookUrl) {
    updateSheetSyncStatus("Paste the deployed Apps Script Web App URL ending in /exec.");
    showToast("Paste the Google Apps Script URL first");
    return;
  }

  state.settings.sheetWebhookUrl = webhookUrl;
  state.settings.sheetAutoUpdate = Boolean(els.sheetAutoUpdate?.checked);
  state.settings.sheetHourlyUpdate = Boolean(els.sheetHourlyUpdate?.checked);
  if (els.sheetWebhookUrl) els.sheetWebhookUrl.value = webhookUrl;
  saveState();
  configureHourlySheetSync();
  updateGoogleSheet(true);
}

function updateTotalCoupons(event) {
  event.preventDefault();
  const totalCoupons = positiveInteger(els.totalCouponInput.value);
  if (!totalCoupons) {
    showToast("Enter a valid total coupon count");
    return;
  }

  const currentTotal = couponTotal();
  if (totalCoupons < currentTotal) {
    const removedCoupons = state.coupons.slice(totalCoupons).filter(hasCouponData).length;
    const message = removedCoupons
      ? `Reducing to ${totalCoupons} will remove ${removedCoupons} coupons with saved assignment or sale data. Continue?`
      : `Reducing to ${totalCoupons} will remove coupon numbers above ${totalCoupons}. Continue?`;
    if (!window.confirm(message)) return;
  }

  state.settings.totalCoupons = totalCoupons;
  state.coupons = normalizeCoupons(state.coupons, totalCoupons);
  saveState();
  render();
  addAuditEntry(`Updated total coupons to ${totalCoupons}`);
  showToast(`Total coupons updated to ${totalCoupons}`);
}

function resetOneCoupon(event) {
  event.preventDefault();
  const number = positiveInteger(els.resetCouponNumber.value);
  if (!number || number > couponTotal()) {
    showToast(`Enter a coupon number from 1 to ${couponTotal()}`);
    return;
  }

  if (!window.confirm(`Reset coupon ${number}? This will clear assignment, buyer details, amount, description, and settlement.`)) return;
  state.coupons[number - 1] = { ...emptyCoupon(number), _updated: Date.now() };
  els.resetCouponForm.reset();
  saveState();
  render();
  showToast(`Coupon ${number} reset`);
}

function resetSelectedCoupons() {
  const numbers = selectedResetCouponNumbers();
  if (!numbers.length) {
    showToast("Select coupons to reset");
    return;
  }

  resetCouponNumbers(numbers, `Reset ${numbers.length} selected coupon(s)? This will clear their assignment and sale details.`);
}

function resetDevoteeCoupons() {
  const devoteeId = els.resetDevotee.value;
  if (!devoteeId) {
    showToast("Select a devotee first");
    return;
  }

  const numbers = couponsForDevotee(devoteeId).map((coupon) => coupon.number);
  if (!numbers.length) {
    showToast("This devotee has no assigned coupons");
    return;
  }

  resetCouponNumbers(numbers, `Reset all ${numbers.length} coupon(s) assigned to ${devoteeName(devoteeId)}?`);
}

function resetAllCoupons() {
  if (!window.confirm("Reset all coupons? This will clear every assignment, buyer detail, amount, description, and settlement.")) return;
  const typed = window.prompt('Type RESET to confirm resetting all coupons.');
  if (typed !== "RESET") {
    showToast("Reset all cancelled");
    return;
  }

  const updatedAt = Date.now();
  state.coupons = makeCoupons(couponTotal()).map((coupon) => ({ ...coupon, _updated: updatedAt }));
  addAuditEntry("Reset all coupons");
  saveState();
  render();
  showToast("All coupons reset");
}

function resetCouponNumbers(numbers, message) {
  if (!window.confirm(message)) return;
  numbers.forEach((number) => {
    state.coupons[number - 1] = { ...emptyCoupon(number), _updated: Date.now() };
  });
  saveState();
  render();
  showToast(`${numbers.length} coupon(s) reset`);
}

function selectedResetCouponNumbers() {
  return Array.from(els.resetCouponList.querySelectorAll("[data-reset-coupon]:checked"))
    .map((item) => Number(item.dataset.resetCoupon))
    .filter(Boolean);
}

function selectAllResetCoupons() {
  els.resetCouponList.querySelectorAll("[data-reset-coupon]").forEach((checkbox) => {
    checkbox.checked = true;
  });
}

function clearResetSelection() {
  els.resetCouponList.querySelectorAll("[data-reset-coupon]").forEach((checkbox) => {
    checkbox.checked = false;
  });
}

function assignCoupons(event) {
  event.preventDefault();
  const devoteeId = els.assignDevotee.value;
  const from = Number(els.assignFrom.value);
  const to = Number(els.assignTo.value);
  const assignedAt = els.assignDate.value || todayKey();
  const sendWhatsApp = Boolean(els.assignSendWhatsapp?.checked);

  if (!devoteeId) {
    showToast("Please add and select a devotee first");
    return;
  }

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > couponTotal() || from > to) {
    showToast(`Enter a valid coupon range from 1 to ${couponTotal()}`);
    return;
  }

  if (!assignedAt) {
    showToast("Select an assign date");
    return;
  }

  const blocked = state.coupons.filter((coupon) => {
    return coupon.number >= from && coupon.number <= to && coupon.devoteeId && coupon.devoteeId !== devoteeId;
  });

  if (blocked.length) {
    const sample = blocked.slice(0, 8).map((coupon) => coupon.number).join(", ");
    els.assignHint.textContent = `Already assigned to another devotee: ${sample}${blocked.length > 8 ? "..." : ""}`;
    return;
  }

  const devotee = state.devotees.find((item) => item.id === devoteeId);

  state.coupons.forEach((coupon) => {
    if (coupon.number >= from && coupon.number <= to) {
      coupon.devoteeId = devoteeId;
      coupon.assignedAt = assignedAt;
      markCouponUpdated(coupon);
    }
  });

  els.assignForm.reset();
  els.assignDate.value = todayKey();
  els.assignHint.textContent = "";
  saveState();
  render();
  addAuditEntry(`Assigned coupons ${from}-${to} to ${devotee ? devotee.name : devoteeId}`);
  showToast(`Assigned coupons ${from} to ${to}`);

  if (sendWhatsApp) {
    openWhatsAppForDevoteeAssignment(devotee, from, to, assignedAt);
  }
}

function render() {
  validateSession();
  renderSelectors();
  renderAllDevoteeFilter();
  renderAllSevaFilter();
  renderDashboardDevoteeFilter();
  updateDevoteePendingDisplay();
  applyRoleAccess();
  renderStats();
  renderDevotees();
  renderSevaSummary();
  renderCharts();
  renderAuditLog();
  renderResetCouponList();
  renderEntryList();
  renderAllCoupons();
  renderPagination();
  renderCheckinView();
  updateAdminView();
  loadInvitationTemplate(); // ✅ populate textarea from saved state

  const topStats = document.querySelector(".stats-grid");

  if (topStats) {
    if (session?.role === "devotee") {
      topStats.style.display = "none";
    } else {
      topStats.style.display = "grid";
    }
  }
}

function renderSelectors() {

  // ✅ SORT DEVOTEES ASCENDING
  const sortedDevotees = [...state.devotees].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // ✅ CREATE OPTIONS
  const options = sortedDevotees
    .map((devotee) =>
      `<option value="${escapeAttr(devotee.id)}">
        ${escapeHtml(devotee.name)}
      </option>`
    )
    .join("");

  const empty = '<option value="">Select devotee</option>';

  // ✅ LOGIN DROPDOWN
  els.loginDevotee.innerHTML = empty + options;

  // ✅ ASSIGN DROPDOWN
  const currentAssignValue = els.assignDevotee.value;
  els.assignDevotee.innerHTML = empty + options;
  if (state.devotees.some((devotee) => devotee.id === currentAssignValue)) {
    els.assignDevotee.value = currentAssignValue;
  }

  // ✅ RESET DROPDOWN
  const currentResetValue = els.resetDevotee.value;

  els.resetDevotee.innerHTML = empty + options;

  if (
    state.devotees.some(
      (devotee) => devotee.id === currentResetValue
    )
  ) {
    els.resetDevotee.value = currentResetValue;
  }

  // ✅ ENTRY DROPDOWN
  const currentEntryValue = els.entryDevotee.value;

  els.entryDevotee.innerHTML = empty + options;

  if (session?.role === "devotee") {

    els.entryDevotee.value = session.devoteeId;

  } else if (
    state.devotees.some(
      (devotee) => devotee.id === currentEntryValue
    )
  ) {

    els.entryDevotee.value = currentEntryValue;

  } else if (sortedDevotees.length) {

    els.entryDevotee.value = sortedDevotees[0].id;
  }

  renderLoginRole();
  renderResetCouponList();
}

function validateSession() {
  if (!session) {
    document.body.classList.remove("logged-in");
    return;
  }

  if (session.role === "devotee" && !state.devotees.some((devotee) => devotee.id === session.devoteeId)) {
    saveSession(null);
    document.body.classList.remove("logged-in");
    return;
  }

  document.body.classList.add("logged-in");
}

function applyRoleAccess() {
  const isAdmin = session?.role === "admin";
  const isViewer = session?.role === "viewer";
  const isDevotee = session?.role === "devotee";
  const activeDevotee = isDevotee
    ? state.devotees.find((devotee) => devotee.id === session.devoteeId)
    : null;

  // Badge label
  els.userBadge.textContent = isAdmin
    ? "Admin"
    : isViewer
      ? "👁 Viewer"
      : activeDevotee
        ? `Devotee: ${activeDevotee.name}`
        : "";

  // Export / import — admin only
  els.csvBtn.classList.toggle("hidden", !isAdmin);
  els.exportBtn.classList.toggle("hidden", !isAdmin);
  els.importFile.closest(".file-label").classList.toggle("hidden", !isAdmin);
  if (els.bulkWhatsAppBtn) els.bulkWhatsAppBtn.classList.toggle("hidden", !isAdmin);
  if (els.bulkPdfBtn) els.bulkPdfBtn.classList.toggle("hidden", !isAdmin);
  if (els.printViewBtn) els.printViewBtn.classList.toggle("hidden", !isAdmin);
  // Language & dark mode toggle — always visible when logged in
  if (els.darkToggle) els.darkToggle.classList.toggle("hidden", !session);
  if (els.langToggle) els.langToggle.classList.toggle("hidden", !session);

  // Devotee entry dropdown
  els.entryDevotee.disabled = isDevotee;
  els.entryStatus.classList.toggle("hidden", isDevotee);
  if (isDevotee) els.entryStatus.value = "all";

  // All Coupons tab — visible to admin & viewer
  document.querySelector('[data-view="allCouponsView"]').classList.toggle("hidden", !isAdmin && !isViewer);

  // Devotee Entry tab — hidden for viewer
  document.querySelector('[data-view="devoteeView"]')?.classList.toggle("hidden", isViewer);

  // Check-in tab — visible to all logged-in users
  document.querySelector('[data-view="checkinView"]')?.classList.toggle("hidden", !session);

  // Admin sub-tabs: viewer sees Dashboard only (no Setup / Reset)
  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    if (isViewer) {
      tab.classList.toggle("hidden", tab.dataset.adminTab !== "dashboard");
    } else {
      tab.classList.toggle("hidden", !isAdmin);
    }
  });

  // Viewer: land on admin dashboard (only if not already on All Coupons)
  if (isViewer) {
    const allCouponsActive = document.getElementById("allCouponsView")?.classList.contains("active");
    if (!allCouponsActive) {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      document.getElementById("adminView")?.classList.add("active");
      activeAdminTab = "dashboard";
      updateAdminView();
    }
  }

  // Devotee: land on devotee entry view (but allow switching to check-in)
  if (isDevotee) {
    const activeViewId = document.querySelector(".view.active")?.id;
    if (activeViewId !== "checkinView") {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelector('[data-view="devoteeView"]')?.classList.add("active");
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      document.getElementById("devoteeView")?.classList.add("active");
    }
  }
}

function renderStats() {
  const assigned = state.coupons.filter((coupon) => coupon.devoteeId).length;
  const sold = state.coupons.filter(isSold).length;
  const settled = state.coupons.filter((coupon) => coupon.settled).length;

  // Only settled coupons + hundi count as received
  const settledCouponMoney = state.coupons
    .filter(c => c.settled)
    .reduce((sum, c) => sum + amountValue(c.amount), 0);
  const hundiMoney = (state.hundi || []).filter(h => h.settled).reduce((sum, h) => sum + h.amount, 0);

  // Unsettled = sold but not yet settled
  const unsettledMoney = state.coupons
    .filter(c => isSold(c) && !c.settled)
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  const templeTransfer = state.coupons
    .filter(c => c.paymentMode === "temple_transfer")
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  const cashTotal = state.coupons
    .filter(c => c.settled && c.paymentMode === "cash")
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  els.totalCoupons.textContent = couponTotal().toLocaleString("en-IN");
  els.assignedCoupons.textContent = assigned.toLocaleString("en-IN");
  els.soldCoupons.textContent = sold.toLocaleString("en-IN");
  if (els.couponSettledMoney) els.couponSettledMoney.textContent = formatMoney(settledCouponMoney);
  if (els.hundiSettledMoney) els.hundiSettledMoney.textContent = formatMoney(hundiMoney);
  els.moneyReceived.textContent = formatMoney(settledCouponMoney + hundiMoney);
  els.settledCoupons.textContent = settled.toLocaleString("en-IN");
  if (els.unsettledMoney) els.unsettledMoney.textContent = formatMoney(unsettledMoney);
  if (els.templeTransferMoney) els.templeTransferMoney.textContent = formatMoney(templeTransfer);
  if (els.cashTotalMoney) els.cashTotalMoney.textContent = formatMoney(cashTotal);
}

function renderDevotees() {

  // 🔒 Prevent devotees from seeing admin dashboard
  if (session?.role === "devotee") {
    if (els.devoteeList) els.devoteeList.innerHTML = "";
    return;
  }

  const query = els.devoteeSearch.value.trim().toLowerCase();
  const statusFilter = els.devoteeStatusFilter?.value || "all";
  const period = settlementPeriod();

  // ✅ FILTER DEVOTEES — by dropdown selection
  const selectedDevotee = els.dashboardDevoteeFilter?.value || "all";

  // ✅ FILTER DEVOTEES — by name/contact search
  let devotees = state.devotees.filter((devotee) => {
    if (selectedDevotee !== "all" && devotee.id !== selectedDevotee) return false;
    return `${devotee.name} ${devotee.contact}`.toLowerCase().includes(query);
  });

  // ✅ FILTER BY STATUS
  if (statusFilter !== "all") {
    devotees = devotees.filter((devotee) => {
      const assigned = state.coupons.filter(c => c.devoteeId === devotee.id);
      const sold = assigned.filter(isSold);
      const settled = assigned.filter(c => c.settled);
      const pending = sold.filter(c => !c.settled);

      if (statusFilter === "has_pending") return pending.length > 0;
      if (statusFilter === "fully_settled") return sold.length > 0 && pending.length === 0;
      if (statusFilter === "not_started") return assigned.length > 0 && sold.length === 0;
      if (statusFilter === "no_coupons") return assigned.length === 0;
      return true;
    });
  }

  // ✅ SORT DEVOTEES BY NAME (ASCENDING)
  devotees.sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // ✅ HUNDI PERIOD TOTAL
  const hundiPeriod = (state.hundi || [])
    .filter(h => h.settled && inSettlementPeriod({ settledAt: h.date }, period))
    .reduce((sum, h) => sum + h.amount, 0);

  // ✅ COUPON PERIOD TOTAL
  const periodTotal = state.coupons
    .filter((coupon) =>
      coupon.settled &&
      inSettlementPeriod(coupon, period)
    )
    .reduce((sum, coupon) =>
      sum + amountValue(coupon.amount), 0
    ) + hundiPeriod;

  els.adminPeriodSummary.textContent =
    `Money settled ${period.label}: ${formatMoney(periodTotal)}`;

  // ✅ EMPTY STATE
  if (!devotees.length) {
    els.devoteeList.innerHTML =
      `<div class="empty">No devotees found.</div>`;
    return;
  }

  // ✅ RENDER DEVOTEES
  els.devoteeList.innerHTML = devotees.map((devotee) => {

    const summary = devoteeSummary(devotee.id, period);

    const assigned = couponsForDevotee(devotee.id);

    const ranges = summarizeCouponRanges(
      assigned.map((coupon) => coupon.number)
    );

    return `
      <article class="devotee-row">

        <div>
          <strong>
            ${escapeHtml(devotee.name)}
            <span class="pin-mask" title="Click to reveal PIN" data-pin="${escapeAttr(devotee.pin || '')}">
              ${devotee.pin ? '••••' : 'No PIN'}
            </span>
          </strong>

          <span class="small-stat">
            ${escapeHtml(devotee.contact || "No contact number")}
          </span>

          <div>
            ${ranges.map((range) =>
      `<span class="coupon-pill">${range}</span>`
    ).join("")
      ||
      '<span class="small-stat">No coupons assigned</span>'
      }
          </div>
        </div>

        <span>
          <strong>${summary.issued}</strong>
          <span class="small-stat"> issued</span>
        </span>

        <span>
          <strong>${summary.sold}</strong>
          <span class="small-stat"> sold</span>
        </span>

        <span>
          <strong>${summary.left}</strong>
          <span class="small-stat"> left</span>
        </span>

        <span>
          <strong>${formatMoney(summary.settledAmount)}</strong>
          <span class="small-stat"> coupons</span>
        </span>

        <span>
          <strong>${formatMoney(summary.hundiAmount || 0)}</strong>
          <span class="small-stat"> hundi</span>
        </span>

        <span>
          <strong>${formatMoney(summary.totalSettledAmount)}</strong>
          <span class="small-stat"> total settled</span>
        </span>

        <span>
          <strong>${formatMoney(summary.templeTransferAmount || 0)}</strong>
          <span class="small-stat"> temple transfer</span>
        </span>

        <span>
          <strong>${formatMoney(summary.pendingAmount)}</strong>
          <span class="small-stat"> pending</span>
        </span>

        ${session?.role === "viewer" ? "" : `
        <label class="checkbox-line can-checkin-toggle" title="Allow this devotee to mark attendance on event day">
          <input type="checkbox" data-can-checkin="${escapeAttr(devotee.id)}" ${devotee.canCheckin ? "checked" : ""}>
          Check-in
        </label>
        <button
          class="ghost"
          type="button"
          data-set-password="${escapeAttr(devotee.id)}">
          Set Password
        </button>

        <button
          class="ghost"
          type="button"
          data-send-whatsapp="${escapeAttr(devotee.id)}">
          WhatsApp
        </button>

        <button
          class="ghost"
          type="button"
          data-update-contact="${escapeAttr(devotee.id)}">
          Update Contact
        </button>

        <button
          class="danger"
          data-delete-devotee="${escapeAttr(devotee.id)}">
          Delete
        </button>

        <button
          class="ghost"
          type="button"
          data-open-devotee="${escapeAttr(devotee.id)}">
          Open
        </button>
        `}

      </article>
    `;

  }).join("");

  // ✅ PIN REVEAL ON CLICK
  els.devoteeList.querySelectorAll(".pin-mask")
    .forEach((span) => {
      let revealed = false;
      span.addEventListener("click", () => {
        revealed = !revealed;
        span.textContent = revealed
          ? (span.dataset.pin || 'Not set')
          : (span.dataset.pin ? '••••' : 'No PIN');
        span.title = revealed ? 'Click to hide PIN' : 'Click to reveal PIN';
      });
    });

  // ✅ OPEN DEVOTEE
  els.devoteeList.querySelectorAll("[data-open-devotee]")
    .forEach((button) => {

      button.addEventListener("click", () => {

        els.entryDevotee.value = button.dataset.openDevotee;

        document
          .querySelector('[data-view="devoteeView"]')
          .click();
      });
    });

  // ✅ CAN CHECK-IN TOGGLE
  els.devoteeList.querySelectorAll("[data-can-checkin]")
    .forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const devotee = state.devotees.find(
          (item) => item.id === checkbox.dataset.canCheckin
        );
        if (!devotee) return;
        devotee.canCheckin = checkbox.checked;
        saveState();
        showToast(`${devotee.name} check-in ${checkbox.checked ? "enabled" : "disabled"}`);
      });
    });

  // ✅ SET PASSWORD
  els.devoteeList.querySelectorAll("[data-set-password]")
    .forEach((button) => {

      button.addEventListener("click", () => {

        const devotee = state.devotees.find(
          (item) => item.id === button.dataset.setPassword
        );

        if (!devotee) return;

        const password = window.prompt(
          `Enter new password for ${devotee.name}`
        );

        if (password === null) return;

        if (password.trim().length < 4) {
          showToast("Use at least 4 characters");
          return;
        }

        devotee.pin = password.trim();

        saveState();
        renderDevotees();
        renderSelectors();

        showToast(`Password updated for ${devotee.name}`);
      });
    });

  // ✅ WHATSAPP
  els.devoteeList.querySelectorAll("[data-send-whatsapp]")
    .forEach(btn => {

      btn.addEventListener("click", () => {

        const devotee = state.devotees.find(
          d => d.id === btn.dataset.sendWhatsapp
        );

        if (!devotee) return;

        const period = settlementPeriod();

        const summary = devoteeSummary(devotee.id, period);

        const assigned = couponsForDevotee(devotee.id).length;

        const message =
          `Hare Krishna 🙏

${devotee.name},

Here is your seva summary:

🔐 PIN: ${devotee.pin || "Not set"}

🎟 Coupons Assigned: ${assigned}
🟢 Sold Coupons: ${summary.sold}
🟡 Pending Coupons: ${summary.left}

💰 Amount Settled: ${formatMoney(summary.settledAmount)}
⌛ Amount Pending: ${formatMoney(summary.pendingAmount)}

Please continue your seva enthusiastically 🙏

Use the following link to update your coupons:
https://vikram34it.github.io/coupons-tracker/
`;

        const phone = (devotee.contact || "")
          .replace(/\D/g, "");

        if (!phone) {
          showToast("No contact number for this devotee");
          return;
        }

        const url = buildWhatsAppUrl(phone, message);
        if (!url) {
          showToast("Enter valid contact number for this devotee");
          return;
        }

        window.open(url, "_blank");

      });
    });

  // ✅ UPDATE CONTACT
  els.devoteeList.querySelectorAll("[data-update-contact]")
    .forEach(btn => {

      btn.addEventListener("click", () => {

        const devotee = state.devotees.find(
          d => d.id === btn.dataset.updateContact
        );

        if (!devotee) return;

        const newContact = window.prompt(
          `Enter new contact for ${devotee.name}`,
          devotee.contact || ""
        );

        if (newContact === null) return;

        const cleaned = cleanIndianMobile(newContact);

        if (!cleaned) {
          showToast("Enter valid 10-digit mobile number");
          return;
        }

        devotee.contact = cleaned;

        saveState();
        render();

        showToast(`Contact updated for ${devotee.name}`);
      });
    });

  // ✅ DELETE DEVOTEE
  els.devoteeList.querySelectorAll("[data-delete-devotee]")
    .forEach(btn => {

      btn.addEventListener("click", () => {
        deleteDevotee(btn.dataset.deleteDevotee);
      });

    });
}

function deleteDevotee(devoteeId) {
  const devotee = state.devotees.find(d => d.id === devoteeId);
  if (!devotee) return;

  const assignedCoupons = state.coupons.filter(c => c.devoteeId === devoteeId);

  if (assignedCoupons.length > 0) {
    const confirmDelete = confirm(
      `${devotee.name} has ${assignedCoupons.length} assigned coupons.\n\nDelete anyway?`
    );
    if (!confirmDelete) return;
  }

  // Remove devotee
  state.devotees = state.devotees.filter(d => d.id !== devoteeId);

  // Unassign coupons
  state.coupons.forEach(c => {
    if (c.devoteeId === devoteeId) {
      c.devoteeId = "";
      c.assignedAt = "";
      markCouponUpdated(c);
    }
  });

  addAuditEntry(`Deleted devotee: ${devotee.name}`);
  saveState();
  render();
  showToast("Devotee deleted successfully");
}


function renderResetCouponList() {
  if (!els.resetCouponList) return;
  const devoteeId = els.resetDevotee.value;
  if (!devoteeId) {
    els.resetCouponList.innerHTML = `<div class="empty">Select a devotee to see assigned coupons.</div>`;
    return;
  }

  const coupons = couponsForDevotee(devoteeId);
  if (!coupons.length) {
    els.resetCouponList.innerHTML = `<div class="empty">No coupons are assigned to this devotee.</div>`;
    return;
  }

  els.resetCouponList.innerHTML = coupons.map((coupon) => `
    <label class="reset-option">
      <input type="checkbox" data-reset-coupon="${coupon.number}">
      <span>
        <strong>#${coupon.number}</strong>
        <small>${escapeHtml(coupon.buyerName || "No buyer")} | ${coupon.amount ? escapeHtml(formatMoney(amountValue(coupon.amount))) : "No amount"}</small>
      </span>
      <span class="status ${coupon.settled ? "settled" : isSold(coupon) ? "sold" : "pending"}">
        ${coupon.settled ? "Settled" : isSold(coupon) ? "Sold" : "Pending"}
      </span>
    </label>
  `).join("");
}

function renderEntryList() {
  if (activeDevoteeTab === "hundi") {

    const devoteeId = els.entryDevotee.value;

    const entries = (state.hundi || [])
      .filter(h => h.devoteeId === devoteeId)
      .sort((a, b) => b.date.localeCompare(a.date));

    els.entryList.innerHTML = `
    <div class="panel">
      <h3>Add Hundi Entry</h3>
      <div class="inline-fields">
        <input type="date" id="hundiDate" value="${todayKey()}">
        <input type="number" id="hundiAmount" placeholder="Amount">
        <button id="addHundiBtn">Add</button>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            ${session?.role === "admin" ? "<th>Settlement</th>" : ""}
            ${session?.role === "admin" ? "<th>Actions</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${entries.map(e => `
              <tr>
                <td>${e.date}</td>
                <td>${formatMoney(e.amount)}</td>
                ${session?.role === "admin" ? `
                <td>
                  <button class="ghost settlement-btn" type="button" data-hundi-settle="${e.id}">
                    ${e.settled ? "Settled" : "Mark Settled"}
                  </button>
                </td>
                <td>
                  <button class="ghost" type="button" data-hundi-edit="${e.id}">Edit</button>
                  <button class="danger" type="button" data-hundi-delete="${e.id}">Delete</button>
                </td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${session?.role === "admin" ? 4 : 2}">No entries</td></tr>`
      }
        </tbody>
      </table>
    </div>
  `;

    els.entryList.querySelectorAll("[data-hundi-settle]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (session?.role !== "admin") {
          showToast("Only admin can settle hundi");
          return;
        }
        const hundi = state.hundi.find(h => h.id === btn.dataset.hundiSettle);
        if (!hundi) return;
        hundi.settled = !hundi.settled;
        hundi._updated = Date.now();
        saveState();
        renderEntryList();
        renderStats();
        renderDevoteeStats(hundi.devoteeId);
        renderSevaSummary();
        showToast(hundi.settled ? "Hundi settled" : "Hundi marked pending");
      });
    });

    els.entryList.querySelectorAll("[data-hundi-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (session?.role !== "admin") {
          showToast("Only admin can edit hundi");
          return;
        }

        const hundi = state.hundi.find(h => h.id === btn.dataset.hundiEdit);
        if (!hundi) return;

        const date = window.prompt("Enter hundi date (YYYY-MM-DD)", hundi.date || todayKey());
        if (date === null) return;

        const amountInput = window.prompt("Enter hundi amount", String(hundi.amount || ""));
        if (amountInput === null) return;

        const amount = Number(amountInput);
        if (!date.trim() || !amount || amount < 0) {
          showToast("Enter a valid date and amount");
          return;
        }

        hundi.date = date.trim();
        hundi.amount = amount;
        hundi._updated = Date.now();
        saveState();
        renderEntryList();
        renderStats();
        renderDevoteeStats(hundi.devoteeId);
        renderSevaSummary();
        showToast("Hundi entry updated");
      });
    });

    els.entryList.querySelectorAll("[data-hundi-delete]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (session?.role !== "admin") {
          showToast("Only admin can delete hundi");
          return;
        }

        const hundi = state.hundi.find(h => h.id === btn.dataset.hundiDelete);
        if (!hundi) return;

        if (!window.confirm(`Delete hundi entry ${hundi.date} for ${formatMoney(hundi.amount)}?`)) return;

        state.hundi = state.hundi.filter(h => h.id !== hundi.id);
        saveState();
        renderEntryList();
        renderStats();
        renderDevoteeStats(hundi.devoteeId);
        renderSevaSummary();
        showToast("Hundi entry deleted");
      });
    });

    document.getElementById("addHundiBtn").onclick = () => {
      const amount = Number(document.getElementById("hundiAmount").value);
      const date = document.getElementById("hundiDate").value || todayKey();

      if (!amount) {
        showToast("Enter amount");
        return;
      }

      state.hundi.push({
        id: newId(),
        devoteeId,
        amount,
        date,
        settled: false,
        _updated: Date.now()
      });

      saveState();
      renderEntryList();
      renderStats();
      renderDevoteeStats(devoteeId);
      renderSevaSummary();
      showToast("Hundi added");
    };

    return;
  }
  const devoteeId = els.entryDevotee.value;

  // 🔥 Only render stats in Dashboard tab
  if (activeDevoteeTab === "dashboard") {
    renderDevoteeStats(devoteeId);
    els.entryList.innerHTML = "";
    return;
  }

  // ❌ Clear stats in other tabs
  els.devoteeStats.innerHTML = "";

  if (!devoteeId) {
    els.devoteeStats.innerHTML = "";
    els.entryList.innerHTML = `<div class="empty">Add a devotee and assign coupons to begin entry.</div>`;
    return;
  }

  const query = els.entrySearch.value.trim().toLowerCase();
  const status = els.entryStatus.value;
  let coupons = couponsForDevotee(devoteeId);

  if (activeDevoteeTab === "pending") coupons = coupons.filter((coupon) => !coupon.settled);
  if (activeDevoteeTab === "settled") coupons = coupons.filter((coupon) => coupon.settled);
  if (activeDevoteeTab === "settled") {
    const hasTemplate = Boolean(state.settings.invitationMessage);
    const noTemplateBanner = !hasTemplate
      ? `<div style="background:#fff4df;border:1px solid #f0c46a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#7a5300">
           ⚠️ No invitation template set. <strong>Admin: go to Setup → WhatsApp Invitation Template</strong> to create one.
         </div>`
      : "";

    const settledWithContact = coupons.filter(c => c.buyerContact);
    const bulkWaEnabled = state.settings.invitationMessage && settledWithContact.length > 0;

    els.entryList.innerHTML = `
    ${noTemplateBanner}
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button id="devoteeBulkWhatsAppBtn" class="ghost bulk-wa-btn no-print" type="button" ${bulkWaEnabled ? "" : "disabled"} style="font-size:13px">
        📲 Bulk WhatsApp (${settledWithContact.length})
      </button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coupon</th>
            <th>Buyer</th>
            <th>Contact</th>
            <th>Call</th>
            <th>Sold Date</th>
            <th>Amount</th>
            <th>Seva</th>
            <th>Receipt</th>
            <th>Payment Mode</th>
            <th>Send Invite</th>
          </tr>
        </thead>
        <tbody>
          ${coupons.map(coupon => `
            <tr>
              <td>#${coupon.number}</td>
              <td>${escapeHtml(coupon.buyerName || "-")}</td>
              <td>${escapeHtml(coupon.buyerContact || "-")}</td>
              <td>${coupon.buyerContact ? `<a href="tel:${escapeAttr(coupon.buyerContact)}" class="call-btn" title="Call ${escapeAttr(coupon.buyerContact)}">📞</a>` : '-'}</td>
              <td>${escapeHtml(coupon.soldAt || "-")}</td>
              <td>${formatMoney(coupon.amount)}</td>
              <td>${escapeHtml(coupon.description || "-")}</td>
              <td>${escapeHtml(coupon.receiptNumber || "-")}</td>
              <td>${coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"}</td>
              <td>
                ${coupon.buyerContact
        ? `<button class="wa-btn" type="button" data-wa-coupon="${coupon.number}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                      Send
                    </button>`
        : `<span class="small-stat">No contact</span>`
      }
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

    // Wire up individual send buttons
    els.entryList.querySelectorAll("[data-wa-coupon]").forEach(btn => {
      btn.addEventListener("click", () => {
        const coupon = state.coupons[Number(btn.dataset.waCoupon) - 1];
        openWhatsAppForBuyer(coupon);
      });
    });

    // Wire up devotee bulk WhatsApp button
    const bulkWaBtn = document.getElementById("devoteeBulkWhatsAppBtn");
    if (bulkWaBtn && !bulkWaBtn.disabled) {
      bulkWaBtn.addEventListener("click", () => {
        devoteeBulkWhatsApp(devoteeId);
      });
    }

    return; // 🔥 VERY IMPORTANT (stops card rendering)
  }
  if (status === "sold") coupons = coupons.filter(isSold);
  if (status === "unsold") coupons = coupons.filter((coupon) => !isSold(coupon));
  if (status === "settled") coupons = coupons.filter((coupon) => coupon.settled);
  if (status === "unsettled") coupons = coupons.filter((coupon) => !coupon.settled);
  if (query) coupons = coupons.filter((coupon) => couponSearchText(coupon).includes(query));

  if (!coupons.length) {
    els.entryList.innerHTML = activeDevoteeTab === "settled"
      ? `<div class="empty">No settled coupons found.</div>`
      : `<div class="empty">No pending coupons found.</div>`;
    return;
  }

  els.entryList.innerHTML = coupons.map((coupon) => {
    const locked = session?.role === "devotee" && coupon.settled ? "disabled" : "";
    return `
      <article class="coupon-card" data-coupon-number="${coupon.number}">
        <div class="coupon-number">
          <strong>#${coupon.number}</strong>
          <span class="status ${isSold(coupon) ? 'sold' : 'pending'}">${isSold(coupon) ? 'Sold' : 'Pending'}</span>
          <span class="status ${coupon.settled ? 'settled' : 'pending'}">${coupon.settled ? 'Settled' : 'Not Settled'}</span>
        </div>
        <div class="coupon-fields">
          <label>
            Buyer Name
            <input data-field="buyerName" autocomplete="name" value="${escapeAttr(coupon.buyerName)}" placeholder="Name" ${locked}>
          </label>
          <label>
            Contact Number
            <input data-field="buyerContact" type="tel" autocomplete="tel" value="${escapeAttr(coupon.buyerContact)}" placeholder="Phone" ${locked}>
          </label>
          <label>
            Amount Received
            <input data-field="amount" type="number" min="0" step="1" value="${escapeAttr(coupon.amount)}" placeholder="0" ${locked}>
          </label>
     <!--     <label>
            Receipt No
           <input data-field="receiptNumber" value="${escapeAttr(coupon.receiptNumber)}" placeholder="Receipt number" ${locked}>
          </label>  -->
          <label>
            Assigned To
            <input value="${escapeAttr(devoteeName(coupon.devoteeId))}" disabled>
          </label>
          <label class="half">
            Seva Type
            <select data-field="description" ${locked}>
              <option value="">Select Seva</option>
              ${SEVA_TYPES.map(seva => `
                <option value="${escapeAttr(seva)}" ${coupon.description === seva ? "selected" : ""}>${escapeHtml(seva)}</option>
              `).join("")}
            </select>
          </label>
          <label class="half">
            Payment Mode
            <select data-field="paymentMode" ${locked}>
              <option value="cash" ${(!coupon.paymentMode || coupon.paymentMode === "cash") ? "selected" : ""}>Cash</option>
              <option value="temple_transfer" ${coupon.paymentMode === "temple_transfer" ? "selected" : ""}>Temple Transfer</option>
            </select>
          </label>
        </div>
      </article>
    `;
  }).join("");

  els.entryList.querySelectorAll("[data-field]").forEach((field) => {
    // ✅ FIX: Use 'input' for text inputs (real-time), 'change' only for <select>
    if (field.tagName === "SELECT") {
      field.addEventListener("change", updateCouponField);
    } else {
      field.addEventListener("input", updateCouponField);
    }
  });

  // ✅ Buyer contact 10-digit validation on blur
  els.entryList.querySelectorAll("[data-field='buyerContact']").forEach((input) => {
    input.addEventListener("blur", () => {
      const val = input.value.replace(/\D/g, "");
      if (val && val.length !== 10) {
        showToast("Contact number should be 10 digits");
      }
    });
  });
}

function renderAllCoupons() {
  const query = els.allSearch.value.trim().toLowerCase();
  const status = els.allStatus.value;
  const sevaFilter = els.allSevaFilter?.value || "all";
  const paymentFilter = els.allPaymentFilter?.value || "all";
  let coupons = state.coupons;

  if (status === "unassigned") coupons = coupons.filter((coupon) => !coupon.devoteeId);
  if (status === "assigned") coupons = coupons.filter((coupon) => coupon.devoteeId);
  if (status === "sold") coupons = coupons.filter(isSold);
  if (status === "settled") coupons = coupons.filter((coupon) => coupon.settled);
  if (status === "unsettled") coupons = coupons.filter((coupon) => coupon.devoteeId && !coupon.settled);
  if (status === "sold_unsettled") {
    coupons = coupons.filter(c =>
      c.devoteeId &&              // must be assigned
      isSold(c) &&               // must be sold
      !c.settled &&              // must NOT be settled
      amountValue(c.amount) > 0  // must have real amount
    );
  }
  const devoteeFilter = els.allDevoteeFilter?.value;

  if (devoteeFilter && devoteeFilter !== "all") {
    coupons = coupons.filter(c => c.devoteeId === devoteeFilter);
  }
  if (sevaFilter !== "all") {
    coupons = coupons.filter(c => (c.description || "") === sevaFilter);
  }
  if (paymentFilter !== "all") {
    coupons = coupons.filter(c => (c.paymentMode || "cash") === paymentFilter);
  }
  if (query) coupons = coupons.filter((coupon) => couponSearchText(coupon).includes(query));

  couponDataCache = coupons;

  if (currentSortColumn) {
    couponDataCache.sort((a, b) => {
      let aVal, bVal;
      if (currentSortColumn === "number") { aVal = a.number; bVal = b.number; }
      else if (currentSortColumn === "devotee") { aVal = devoteeName(a.devoteeId); bVal = devoteeName(b.devoteeId); }
      else if (currentSortColumn === "buyerName") { aVal = a.buyerName || ""; bVal = b.buyerName || ""; }
      else if (currentSortColumn === "amount") { aVal = amountValue(a.amount); bVal = amountValue(b.amount); }
      else if (currentSortColumn === "settled") { aVal = a.settled ? 1 : 0; bVal = b.settled ? 1 : 0; }
      else { aVal = a[currentSortColumn] || ""; bVal = b[currentSortColumn] || ""; }
      if (typeof aVal === "string") {
        return currentSortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return currentSortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });
  }

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageItems = couponDataCache.slice(startIdx, startIdx + PAGE_SIZE);

  if (els.allCouponCount) {
    const label = coupons.length === 1 ? "Coupon" : "Coupons";
    els.allCouponCount.textContent = `${label}: ${coupons.length.toLocaleString("en-IN")}`;
  }

  els.allCouponsBody.innerHTML = pageItems.map((coupon) => {
    const isViewer = session?.role === "viewer";
    return `
    <tr>
      <td>#${coupon.number}</td>
      <td>${escapeHtml(devoteeName(coupon.devoteeId) || "-")}</td>
      <td>${escapeHtml(coupon.assignedAt || "-")}</td>
      <td>${escapeHtml(coupon.buyerName || "-")}</td>
      <td>${escapeHtml(coupon.buyerContact || "-")}</td>
      <td>${coupon.buyerContact ? `<a href="tel:${escapeAttr(coupon.buyerContact)}" class="call-btn" title="Call ${escapeAttr(coupon.buyerContact)}">📞</a>` : '-'}</td>
      <td>${escapeHtml(coupon.soldAt || "-")}</td>
      <td>${coupon.amount ? escapeHtml(formatMoney(amountValue(coupon.amount))) : "-"}</td>
      <td>${escapeHtml(coupon.receiptNumber || "-")}</td>
      <td>${coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"}</td>
      <td>
        ${isViewer
        ? `<span class="status ${coupon.settled ? 'settled' : 'pending'}">${coupon.settled ? "\u2713 Settled" : "Pending"}</span>`
        : `<button class="ghost settlement-btn${coupon.settled ? ' is-settled' : ''}" type="button" data-settlement="${coupon.number}">
              ${coupon.settled ? "\u2713 Settled" : "Mark Settled"}
            </button>`
      }
      </td>
      <td>${escapeHtml(coupon.settledAt || "-")}</td>
      <td>${escapeHtml(coupon.description || "-")}</td>
      <td>
        <button class="qr-btn" type="button" data-qr-coupon="${coupon.number}" title="Show QR for coupon #${coupon.number}">QR</button>
      </td>
      <td>
        ${(!isViewer && coupon.settled && coupon.buyerContact)
        ? `<button class="wa-btn" type="button" data-wa-coupon="${coupon.number}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
              Send
            </button>`
        : `<span class="small-stat">\u2013</span>`
      }
      </td>
    </tr>
  `;
  }).join("");

  els.allCouponsBody.querySelectorAll("[data-settlement]").forEach((button) => {
    button.addEventListener("click", toggleSettlement);
  });

  els.allCouponsBody.querySelectorAll("[data-qr-coupon]").forEach(btn => {
    btn.addEventListener("click", () => {
      const coupon = state.coupons[Number(btn.dataset.qrCoupon) - 1];
      if (coupon) showQrModal(coupon);
    });
  });

  // Wire up WhatsApp send buttons in All Coupons table (admin)
  els.allCouponsBody.querySelectorAll("[data-wa-coupon]").forEach(btn => {
    btn.addEventListener("click", () => {
      const coupon = state.coupons[Number(btn.dataset.waCoupon) - 1];
      openWhatsAppForBuyer(coupon);
    });
  });
}

let currentSortColumn = null;
let currentSortOrder = "asc";
let couponDataCache = [];
let currentPage = 1;
const PAGE_SIZE = 50;

function toggleSettlement(event) {

  if (session?.role !== "admin") {
    showToast("Only admin can update settlement");
    return;
  }

  const coupon =
    state.coupons[
    Number(event.currentTarget.dataset.settlement) - 1
    ];

  // ✅ Confirmation with amount shown
  if (!coupon.settled) {
    const amt = amountValue(coupon.amount);
    const amtText = amt > 0 ? ` for ${formatMoney(amt)}` : '';
    const confirmed = window.confirm(
      `Mark Coupon #${coupon.number}${amtText} as settled?`
    );
    if (!confirmed) return;
  }

  coupon.settled = !coupon.settled;

  coupon.settledAt = coupon.settled
    ? todayKey()
    : "";
  markCouponUpdated(coupon);

  saveState();

  // ✅ Preserve scroll position and filters
  const tableWrap = els.allCouponsBody.closest(".table-wrap");
  const scrollTop = tableWrap ? tableWrap.scrollTop : 0;
  const savedDevoteeFilter = els.allDevoteeFilter ? els.allDevoteeFilter.value : "all";
  const savedStatus = els.allStatus ? els.allStatus.value : "all";
  const savedSevaFilter = els.allSevaFilter ? els.allSevaFilter.value : "all";
  const savedPaymentFilter = els.allPaymentFilter ? els.allPaymentFilter.value : "all";

  renderStats();
  renderDevotees();
  renderSevaSummary();
  updateDevoteePendingDisplay();

  // ✅ Restore filters then render table once
  if (els.allDevoteeFilter && savedDevoteeFilter) els.allDevoteeFilter.value = savedDevoteeFilter;
  if (els.allStatus && savedStatus) els.allStatus.value = savedStatus;
  if (els.allSevaFilter && savedSevaFilter) els.allSevaFilter.value = savedSevaFilter;
  if (els.allPaymentFilter && savedPaymentFilter) els.allPaymentFilter.value = savedPaymentFilter;
  renderAllCoupons();
  renderPagination();

  if (tableWrap) tableWrap.scrollTop = scrollTop;

  addAuditEntry(
    coupon.settled
      ? `Marked coupon #${coupon.number} as settled`
      : `Marked coupon #${coupon.number} as pending`
  );
  showToast(
    coupon.settled
      ? `✓ Coupon ${coupon.number} settled`
      : `Coupon ${coupon.number} marked pending`
  );
}

function updateCouponField(event) {
  const field = event.target;

  const card = field.closest("[data-coupon-number]");
  const coupon = state.coupons[Number(card.dataset.couponNumber) - 1];

  if (session?.role === "devotee" && coupon.devoteeId !== session.devoteeId) {
    showToast("This coupon is not assigned to this devotee");
    return;
  }

  coupon[field.dataset.field] = field.value.trimStart();

  if (!coupon.soldAt && isSold(coupon)) {
    coupon.soldAt = new Date().toISOString();
  }
  if (!coupon.receiptNumber && isSold(coupon) && isAutoReceiptEnabled()) {
    const nextNum = state.coupons.filter(c => c.receiptNumber).length + 1;
    coupon.receiptNumber = `REC-${String(nextNum).padStart(4, "0")}`;
  }
  markCouponUpdated(coupon);
  pendingLocalCouponNumbers.add(coupon.number);
  lastEditTime = Date.now();    // ✅ FIX: record time of last edit
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  // 🔥 DELAY SAVE (KEY FIX)
  queueStateSave();

  // ❌ NO render()
}

function couponsForDevotee(devoteeId) {
  return state.coupons.filter((coupon) => coupon.devoteeId === devoteeId);
}

function couponTotal() {
  return positiveInteger(state.settings.totalCoupons) || state.coupons.length || DEFAULT_TOTAL_COUPONS;
}

function makeCoupons(totalCoupons) {
  return Array.from({ length: totalCoupons }, (_, index) => emptyCoupon(index + 1));
}

function emptyCoupon(number) {
  return {
    number,
    devoteeId: "",
    assignedAt: "",
    buyerName: "",
    buyerContact: "",
    amount: "",
    description: "",
    receiptNumber: "",
    paymentMode: "cash",
    settled: false,
    settledAt: "",
    soldAt: "",
    attended: false,
    attendedAt: "",
    _updated: 0
  };
}

function normalizeCoupons(coupons, totalCoupons) {
  const couponsByNumber = new Map((coupons || []).map((coupon) => [Number(coupon.number), coupon]));
  return Array.from({ length: totalCoupons }, (_, index) => {
    const number = index + 1;
    const savedCoupon = couponsByNumber.get(number) || {};
    return {
      ...emptyCoupon(number),
      devoteeId: savedCoupon.devoteeId || "",
      assignedAt: savedCoupon.assignedAt || "",
      buyerName: savedCoupon.buyerName || "",
      buyerContact: savedCoupon.buyerContact || "",
      amount: savedCoupon.amount || "",
      description: savedCoupon.description || "",
      receiptNumber: savedCoupon.receiptNumber || "",
      paymentMode: savedCoupon.paymentMode || "cash",
      settled: Boolean(savedCoupon.settled),
      settledAt: savedCoupon.settledAt || "",
      soldAt: savedCoupon.soldAt || "",
      attended: Boolean(savedCoupon.attended),
      attendedAt: savedCoupon.attendedAt || "",
      _updated: Number(savedCoupon._updated) || 0
    };
  });
}

function markCouponUpdated(coupon, updatedAt = Date.now()) {
  if (coupon) coupon._updated = updatedAt;
}

function hasCouponData(coupon) {
  return Boolean(
    coupon.devoteeId ||
    coupon.assignedAt ||
    coupon.buyerName ||
    coupon.buyerContact ||
    coupon.amount ||
    coupon.description ||
    coupon.receiptNumber ||
    coupon.settled ||
    coupon.settledAt
  );
}

function renderDevoteeStats(devoteeId) {

  // 🔥 Only show in dashboard tab for devotee
  if (session?.role === "devotee" && activeDevoteeTab !== "dashboard") {
    els.devoteeStats.innerHTML = "";
    return;
  }

  const summary = devoteeSummary(devoteeId);

  els.devoteeStats.innerHTML = `
  <article><span>Coupons Issued</span><strong>${summary.issued}</strong></article>
  <article><span>Coupons Sold</span><strong>${summary.sold}</strong></article>
  <article><span>Coupons Left</span><strong>${summary.left}</strong></article>

  <article><span>Coupons Settled</span><strong>${formatMoney(summary.settledAmount)}</strong></article>
  <article><span>Hundi Settled</span><strong>${formatMoney(summary.hundiAmount || 0)}</strong></article>
  <article><span>Total Settled Amount</span><strong>${formatMoney(summary.totalSettledAmount)}</strong></article>

  <article><span>Pending Coupons Amount</span><strong>${formatMoney(summary.pendingAmount)}</strong></article>
  <article><span>Total Pending Amount</span><strong>${formatMoney(summary.totalPendingAmount)}</strong></article>

  <article><span>Settled Coupons</span><strong>${summary.settledCount}</strong></article>
  <article><span>Temple Transfer</span><strong>${formatMoney(summary.templeTransferAmount || 0)}</strong></article>
`;
}

function devoteeSummary(devoteeId, period = settlementPeriod()) {
  const assigned = couponsForDevotee(devoteeId);
  const sold = assigned.filter(isSold);
  const settled = sold.filter((coupon) => coupon.settled);
  const pending = sold.filter((coupon) => !coupon.settled);
  const periodSettled = settled.filter((coupon) => inSettlementPeriod(coupon, period));
  // ✅ HUNDI CALCULATION
  const hundiEntries = (state.hundi || [])
    .filter(h => h.devoteeId === devoteeId);

  const hundiAmount = hundiEntries.filter(h => h.settled).reduce((sum, h) => sum + h.amount, 0);
  const hundiPendingAmount = hundiEntries.filter(h => !h.settled).reduce((sum, h) => sum + h.amount, 0);

  // ✅ TOTALS
  const totalSettledAmount = settled.reduce((sum, c) => sum + amountValue(c.amount), 0) + hundiAmount;
  const totalPendingAmount = pending.reduce((sum, c) => sum + amountValue(c.amount), 0) + hundiPendingAmount;

  // ✅ TEMPLE TRANSFER AMOUNT (sold coupons with paymentMode = temple_transfer)
  const templeTransferAmount = sold
    .filter(c => c.paymentMode === "temple_transfer")
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  return {
    issued: assigned.length,
    sold: sold.length,
    left: assigned.length - sold.length,

    settledCount: settled.length,
    pendingCount: pending.length,

    settledAmount: settled.reduce((sum, coupon) => sum + amountValue(coupon.amount), 0),
    pendingAmount: pending.reduce((sum, coupon) => sum + amountValue(coupon.amount), 0),

    // ✅ NEW
    hundiAmount,
    totalSettledAmount,
    totalPendingAmount,
    templeTransferAmount
  };
}

function devoteeName(devoteeId) {
  const devotee = state.devotees.find((item) => item.id === devoteeId);
  return devotee ? devotee.name : "";
}

function isSold(coupon) {
  return Boolean(coupon.buyerName || coupon.buyerContact || amountValue(coupon.amount) > 0 || coupon.description);
}

function amountValue(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function couponSearchText(coupon) {
  return [
    coupon.number,
    devoteeName(coupon.devoteeId),
    coupon.assignedAt,
    coupon.buyerName,
    coupon.buyerContact,
    coupon.soldAt,
    coupon.amount,
    coupon.receiptNumber,
    coupon.description,
    coupon.settledAt,
    coupon.settled ? "settled" : "not settled"
  ].join(" ").toLowerCase();
}

function settlementPeriod() {
  const from = els.settledFromDate?.value || "";
  const to = els.settledToDate?.value || "";

  if (from && to) return { from, to, label: `from ${from} to ${to}`, shortLabel: "period settled" };
  if (from) return { from, to: "", label: `from ${from}`, shortLabel: "from date" };
  if (to) return { from: "", to, label: `up to ${to}`, shortLabel: "up to date" };
  return { from: "", to: "", label: "for all dates", shortLabel: "settled total" };
}

function inSettlementPeriod(coupon, period) {
  if (!coupon.settledAt) return !period.from && !period.to;
  if (period.from && coupon.settledAt < period.from) return false;
  if (period.to && coupon.settledAt > period.to) return false;
  return true;
}

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function summarizeCouponRanges(numbers) {
  if (!numbers.length) return [];
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const number = sorted[index];
    if (number === prev + 1) {
      prev = number;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = number;
    prev = number;
  }
  // Always push the final range
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);

  return ranges.slice(0, 8);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `coupon-seva-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const headers = ["Coupon", "Assigned To", "Assigned Date", "Devotee Contact", "Buyer Name", "Buyer Contact", "Sold Date", "Amount", "Settlement", "Settlement Date", "Description", "Payment Mode"];
  const rows = state.coupons.map((coupon) => {
    const devotee = state.devotees.find((item) => item.id === coupon.devoteeId);
    return [
      coupon.number,
      devotee ? devotee.name : "",
      coupon.assignedAt,
      devotee ? devotee.contact : "",
      coupon.buyerName,
      coupon.buyerContact,
      coupon.soldAt,
      coupon.amount,
      coupon.settled ? "Settled" : "Not Settled",
      coupon.settledAt,
      coupon.description,
      coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `coupon-seva-report-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.devotees) || !Array.isArray(imported.coupons)) {
        throw new Error("Invalid backup");
      }

      const importedTotalCoupons = positiveInteger(imported.settings?.totalCoupons) || imported.coupons.length || DEFAULT_TOTAL_COUPONS;
      state.settings = normalizeSettings(
        { ...state.settings, ...imported.settings, totalCoupons: importedTotalCoupons },
        importedTotalCoupons
      );
      state.devotees = imported.devotees.map(normalizeDevotee);
      state.coupons = normalizeCoupons(imported.coupons, state.settings.totalCoupons);
      state.hundi = Array.isArray(imported.hundi)
        ? imported.hundi.map(h => ({ settled: false, ...h }))
        : [];

      saveState();
      render();
      showToast("Backup imported");
    } catch {
      showToast("Could not import this backup file");
    } finally {
      event.target.value = "";
    }
  });
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════
// 📲  WHATSAPP INVITATION FEATURE
// ═══════════════════════════════════════════════

function saveInvitationTemplate(event) {
  event.preventDefault();
  const message = els.invitationMessageInput.value.trim();
  if (!message) {
    showToast("Enter an invitation message template");
    return;
  }
  state.settings.invitationMessage = message;
  saveState();

  // Show "Saved" badge briefly
  if (els.invitationSavedBadge) {
    els.invitationSavedBadge.classList.remove("hidden");
    clearTimeout(saveInvitationTemplate._timer);
    saveInvitationTemplate._timer = setTimeout(() => {
      els.invitationSavedBadge.classList.add("hidden");
    }, 2500);
  }
  showToast("Invitation template saved ✓");
}

function loadInvitationTemplate() {
  if (els.invitationMessageInput) {
    els.invitationMessageInput.value = state.settings.invitationMessage || "";
  }
}

function buildInvitationMessage(coupon) {
  const devotee = state.devotees.find(d => d.id === coupon.devoteeId);
  const template = state.settings.invitationMessage || "";
  return template
    .replace(/{name}/g, coupon.buyerName || "Devotee")
    .replace(/{coupon}/g, String(coupon.number))
    .replace(/{seva}/g, coupon.description || "Seva")
    .replace(/{amount}/g, formatMoney(amountValue(coupon.amount)))
    .replace(/{devotee}/g, devotee ? devotee.name : "");
}

function whatsappPhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits.length >= 10 ? digits : "";
}

function cleanIndianMobile(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return "";
}

function buildWhatsAppUrl(rawPhone, message) {
  const phone = whatsappPhone(rawPhone);
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : "";
}

function appLink() {
  return APP_URL;
}

function buildDevoteeSummaryMessage(devotee) {
  const period = settlementPeriod();
  const summary = devoteeSummary(devotee.id, period);
  const assigned = couponsForDevotee(devotee.id).length;

  return `Hare Krishna

${devotee.name},

Here is your seva summary:

PIN: ${devotee.pin || "Not set"}

Coupons Assigned: ${assigned}
Sold Coupons: ${summary.sold}
Pending Coupons: ${summary.left}

Amount Settled: ${formatMoney(summary.settledAmount)}
Amount Pending: ${formatMoney(summary.pendingAmount)}

Please continue your seva enthusiastically.

Use the following link to update your coupons:
${appLink()}`;
}

function buildAssignmentMessage(devotee, from, to, assignedAt) {
  const count = to - from + 1;
  const range = from === to ? `Coupon ${from}` : `Coupons ${from} to ${to}`;
  const totalAssigned = couponsForDevotee(devotee.id).length;

  return `Hare Krishna

${devotee.name},

${range} (${count} total) have been assigned to you on ${assignedAt}.

Your login PIN: ${devotee.pin || "Not set"}
Total coupons assigned to you: ${totalAssigned}

Please update collection details in Coupon Seva Tracker:
${appLink()}`;
}

function openWhatsAppForDevoteeSummary(devotee) {
  if (!devotee?.contact) {
    showToast("No contact number for this devotee");
    return;
  }

  const url = buildWhatsAppUrl(devotee.contact, buildDevoteeSummaryMessage(devotee));
  if (!url) {
    showToast("Enter valid contact number for this devotee");
    return;
  }

  window.open(url, "_blank");
}

function openWhatsAppForDevoteeAssignment(devotee, from, to, assignedAt) {
  if (!devotee) return;
  if (!devotee.contact) {
    showToast("Coupons assigned, but this devotee has no contact number");
    return;
  }

  const url = buildWhatsAppUrl(devotee.contact, buildAssignmentMessage(devotee, from, to, assignedAt));
  if (!url) {
    showToast("Coupons assigned, but devotee contact number is not valid");
    return;
  }

  window.open(url, "_blank");
}

function openWhatsAppForBuyer(coupon) {
  if (!coupon.buyerContact) {
    showToast("No contact number for this buyer");
    return;
  }
  if (!state.settings.invitationMessage) {
    showToast("No invitation template set — Admin: go to Setup → WhatsApp Invitation Template");
    return;
  }
  const message = buildInvitationMessage(coupon);
  const url = buildWhatsAppUrl(coupon.buyerContact, message);
  if (!url) {
    showToast("Enter valid contact number for this buyer");
    return;
  }
  window.open(url, "_blank");
}

function previewInvitationMessage() {
  const template = els.invitationMessageInput?.value.trim();
  if (!template) {
    showToast("Write a message template first");
    return;
  }

  // Build a sample substitution
  const sample = template
    .replace(/{name}/g, "Ramesh Kumar")
    .replace(/{coupon}/g, "42")
    .replace(/{seva}/g, "Deepa Seva")
    .replace(/{amount}/g, "₹500")
    .replace(/{devotee}/g, "Devotee Name");

  // Create/reuse modal
  let overlay = document.getElementById("invitationPreviewOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "invitationPreviewOverlay";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Message preview">
        <h3>📲 Message Preview</h3>
        <p class="hint" style="margin-bottom:10px">Sample preview using placeholder values.</p>
        <div class="message-preview" id="invitationPreviewText"></div>
        <div class="inline-fields">
          <button type="button" id="invitationPreviewClose">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close on button click
    overlay.querySelector("#invitationPreviewClose").addEventListener("click", () => {
      overlay.classList.add("hidden");
    });
    // Close on backdrop click
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
        overlay.classList.add("hidden");
      }
    });
  }

  document.getElementById("invitationPreviewText").textContent = sample;
  overlay.classList.remove("hidden");
}


function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2200);
}


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function newId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

function normalizeDevotee(devotee) {
  return {
    id: devotee.id,
    name: devotee.name || "",
    contact: devotee.contact || "",
    pin: devotee.pin || "",
    canCheckin: Boolean(devotee.canCheckin)
  };
}
// ================= FIREBASE SYNC (ADD ONLY THIS) =================

let firebaseReady = false;
let dbRef = null;

function updateSyncBadge(text) {
  const badge = els.syncBadge || document.getElementById("syncBadge");
  if (badge) badge.textContent = text;
}

function normalizedUpdatedAt(item) {
  return Number(item?._updated) || 0;
}

function mergeRemoteCoupons(remoteCoupons, preserveCouponNumbers = new Set()) {
  const localCouponsByNumber = new Map(state.coupons.map((coupon) => [coupon.number, coupon]));
  return remoteCoupons.map((remoteCoupon) => {
    const localCoupon = localCouponsByNumber.get(remoteCoupon.number);
    if (!localCoupon) return remoteCoupon;
    if (preserveCouponNumbers.has(remoteCoupon.number)) return localCoupon;

    const localUpdated = normalizedUpdatedAt(localCoupon);
    const remoteUpdated = normalizedUpdatedAt(remoteCoupon);

    if (localUpdated > remoteUpdated) return localCoupon;
    if (remoteUpdated > localUpdated) return remoteCoupon;

    if (hasCouponData(localCoupon) && !hasCouponData(remoteCoupon)) {
      return localCoupon;
    }

    return remoteCoupon;
  });
}

function mergeRemoteDevotees(remoteDevotees) {
  const devoteesById = new Map(remoteDevotees.map((devotee) => [devotee.id, devotee]));
  state.devotees.forEach((localDevotee) => {
    if (!devoteesById.has(localDevotee.id)) {
      devoteesById.set(localDevotee.id, localDevotee);
    }
  });
  return Array.from(devoteesById.values());
}

function hasStateData(candidateState = state) {
  return Boolean(
    candidateState.devotees?.length ||
    candidateState.coupons?.some(hasCouponData) ||
    candidateState.hundi?.length
  );
}

function flushPendingFirebaseWrite() {
  if (!pendingFirebaseWrite || !firebaseCanWrite || !firebaseReady || !dbRef) return;
  pendingFirebaseWrite = false;
  dbRef.update({
    settings: state.settings,
    devotees: state.devotees,
    hundi: state.hundi,
    coupons: state.coupons
  });
}

function applyFirebaseData(data, options = {}) {
  // ✅ FIX: Skip Firebase echo/updates if a devotee edited a field recently
  // This prevents data rollback when Firebase echoes the saved state back
  if (!options.skipRender && !options.preserveCouponNumbers?.size) {
    const timeSinceEdit = Date.now() - lastEditTime;
    if (timeSinceEdit < EDIT_GUARD_MS) {
      // Store as pending — will be applied after edit guard expires
      pendingFirebaseData = data;
      return;
    }
  }

  const preserveCouponNumbers = options.preserveCouponNumbers || new Set();

  if (data.settings) {
    const remoteTotalCoupons = positiveInteger(data.settings?.totalCoupons) ||
      (Array.isArray(data.coupons) ? data.coupons.length : state.coupons.length) ||
      DEFAULT_TOTAL_COUPONS;
    state.settings = normalizeSettings(
      { ...state.settings, ...data.settings, totalCoupons: remoteTotalCoupons },
      remoteTotalCoupons
    );
    configureHourlySheetSync();
  }
  if (Array.isArray(data.devotees) && (data.devotees.length || !state.devotees.length)) {
    const remoteDevotees = data.devotees.map(normalizeDevotee);
    state.devotees = pendingFirebaseWrite
      ? mergeRemoteDevotees(remoteDevotees)
      : remoteDevotees;
  }
  if (Array.isArray(data.coupons)) {
    const remoteCoupons = normalizeCoupons(data.coupons, couponTotal());
    state.coupons = mergeRemoteCoupons(remoteCoupons, preserveCouponNumbers);
  }
  if (Array.isArray(data.hundi) && (data.hundi.length || !state.hundi.length)) {
    state.hundi = data.hundi.map(h => ({ settled: false, ...h }));
  }

  // ✅ IMPORTANT FIX - save to localStorage only (not Firebase yet)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!options.skipRender) {
    renderSelectors();   // 🔥 force sorted dropdown refresh
    render();
  }
  flushPendingFirebaseWrite();
}

let pendingFirebaseRetryTimer = null;

function applyPendingFirebaseData() {
  if (!pendingFirebaseData) return;
  const data = pendingFirebaseData;
  const flushedLocalEdit = flushQueuedStateSave();

  // ✅ FIX: If still within edit guard window, schedule a retry after guard expires
  const timeSinceEdit = Date.now() - lastEditTime;
  if (timeSinceEdit < EDIT_GUARD_MS && !flushedLocalEdit) {
    // Ensure data is still stored as pending
    pendingFirebaseData = data;
    // Schedule retry after guard window passes
    clearTimeout(pendingFirebaseRetryTimer);
    pendingFirebaseRetryTimer = setTimeout(() => {
      if (pendingFirebaseData) {
        const retryData = pendingFirebaseData;
        pendingFirebaseData = null;
        applyFirebaseData(retryData);
      }
    }, EDIT_GUARD_MS - timeSinceEdit + 100);
    return;
  }

  pendingFirebaseData = null;
  if (flushedLocalEdit) return;
  applyFirebaseData(data);
}

function updateAdminView() {
  document.querySelectorAll("[data-admin-section]").forEach(section => {
    section.style.display =
      section.dataset.adminSection === activeAdminTab ? "" : "none";
  });
  if (activeAdminTab === "setup") {
    loadSheetSyncSettings();
  }
}

function initFirebaseSync() {
  try {
    // Check Firebase availability
    if (!window.firebase || !window.COUPON_TRACKER_FIREBASE?.config?.databaseURL) {
      updateSyncBadge("Local");
      updateLoginSyncHint("local");
      return;
    }

    updateSyncBadge("Connecting...");

    // Initialize Firebase (only once)
    if (!firebase.apps.length) {
      firebase.initializeApp(window.COUPON_TRACKER_FIREBASE.config);
    }

    // Anonymous login
    firebase.auth().signInAnonymously()
      .then(() => {
        firebaseReady = true;

        dbRef = firebase.database().ref(
          window.COUPON_TRACKER_FIREBASE.databasePath || "couponTracker/appState"
        );

        // 🔥 Listen to realtime updates
        dbRef.on("value", (snapshot) => {
          if (!snapshot.exists()) return;

          // ✅ FIX: Mark Firebase as loaded on first data arrival
          if (!firebaseHasLoaded) {
            firebaseHasLoaded = true;
            firebaseCanWrite = true;
            // Refresh the login dropdown with real devotee data
            updateLoginSyncHint("ready");
          }

          // 🚫 Don't re-render while typing
          if (isEditing || saveTimer) {
            pendingFirebaseData = snapshot.val();
            return;
          }

          const data = snapshot.val();

          applyFirebaseData(data);
          flushPendingFirebaseWrite();
        });

        updateSyncBadge("Realtime");

        // First-time push if DB empty
        dbRef.once("value").then((snap) => {
          if (!snap.exists()) {
            firebaseHasLoaded = true;
            firebaseCanWrite = true;
            if (hasStateData(state)) {
              dbRef.set(state);
            }
            updateLoginSyncHint("ready");
            flushPendingFirebaseWrite();
          }
        });
      })
      .catch((err) => {
        console.error("Firebase Auth Error:", err);
        updateSyncBadge("Auth error");
        updateLoginSyncHint("local");
      });

  } catch (err) {
    console.error("Firebase Init Error:", err);
    updateSyncBadge("Error");
    updateLoginSyncHint("local");
  }
}

// 🔥 Override saveState for Firebase sync
function spreadsheetRows() {
  return state.coupons.map((coupon) => {
    const devotee = state.devotees.find((item) => item.id === coupon.devoteeId);
    return {
      coupon: coupon.number,
      assignedTo: devotee ? devotee.name : "",
      assignedDate: coupon.assignedAt || "",
      devoteeContact: devotee ? devotee.contact : "",
      buyerName: coupon.buyerName || "",
      buyerContact: coupon.buyerContact || "",
      soldDate: coupon.soldAt || "",
      amount: amountValue(coupon.amount),
      receiptNumber: coupon.receiptNumber || "",
      paymentMode: coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash",
      settlement: coupon.settled ? "Settled" : "Not Settled",
      settledDate: coupon.settledAt || "",
      description: coupon.description || ""
    };
  });
}

function spreadsheetHundiRows() {
  return (state.hundi || []).map((entry) => {
    const devotee = state.devotees.find((item) => item.id === entry.devoteeId);
    return {
      date: entry.date || "",
      devoteeName: devotee ? devotee.name : "",
      devoteeContact: devotee ? devotee.contact : "",
      amount: amountValue(entry.amount),
      settlement: entry.settled ? "Settled" : "Not Settled"
    };
  });
}

function queueSheetAutoUpdate() {
  if (!state.settings.sheetAutoUpdate || !state.settings.sheetWebhookUrl) return;
  updateSheetSyncStatus("Spreadsheet update queued...");
  clearTimeout(sheetSyncTimer);
  sheetSyncTimer = setTimeout(() => {
    sheetSyncTimer = null;
    updateGoogleSheet();
  }, SHEET_SYNC_DEBOUNCE_MS);
}

function configureHourlySheetSync() {
  const nextConfigKey = `${Boolean(state.settings.sheetHourlyUpdate)}|${state.settings.sheetWebhookUrl || ""}`;
  if (nextConfigKey === sheetHourlyConfigKey && (sheetHourlyTimer || !state.settings.sheetHourlyUpdate)) return;

  sheetHourlyConfigKey = nextConfigKey;
  clearInterval(sheetHourlyTimer);
  sheetHourlyTimer = null;

  if (!state.settings.sheetHourlyUpdate || !state.settings.sheetWebhookUrl) return;

  sheetHourlyTimer = setInterval(() => {
    updateGoogleSheet(false, "hourly");
  }, SHEET_HOURLY_SYNC_MS);
}

function updateGoogleSheet(manual = false, reason = "save") {
  if (!state.settings.sheetWebhookUrl) {
    updateSheetSyncStatus("Paste the deployed Apps Script Web App URL ending in /exec.");
    return;
  }
  clearTimeout(sheetSyncTimer);
  sheetSyncTimer = null;
  updateSheetSyncStatus("Sending spreadsheet update...");
  fetch(state.settings.sheetWebhookUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      updatedAt: new Date().toISOString(),
      rows: spreadsheetRows(),
      hundiRows: spreadsheetHundiRows()
    })
  }).then(() => {
    const note = manual
      ? "Update sent. Check the Google Sheet. If it did not change, redeploy Apps Script with access set to Anyone."
      : reason === "hourly"
        ? "Hourly spreadsheet update sent."
        : "Spreadsheet update sent.";
    updateSheetSyncStatus(note);
    if (manual) showToast("Spreadsheet update sent");
  }).catch((err) => {
    console.error("Google Sheets update failed:", err);
    updateSheetSyncStatus("Could not send spreadsheet update. Check the Apps Script URL and deployment access.");
    if (manual) showToast("Spreadsheet update failed");
  });
}

const _localSaveState = saveState;

saveState = function () {
  _localSaveState();
  queueSheetAutoUpdate();

  if (firebaseReady && dbRef) {
    if (firebaseCanWrite) {
      dbRef.update({
        settings: state.settings,
        devotees: state.devotees,
        hundi: state.hundi,
        coupons: state.coupons
      });
    } else {
      pendingFirebaseWrite = true;
      updateSyncBadge("Sync pending");
    }
  }
};

// ═══════════════════════════════════════════════
// 🌙 DARK MODE
// ═══════════════════════════════════════════════

function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  const isDark = document.body.classList.contains("dark-mode");
  els.darkToggle.textContent = isDark ? "☀️" : "🌙";
  els.darkToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  try { localStorage.setItem("coupon-seva-darkmode", isDark ? "1" : "0"); } catch {}
}

function loadDarkModePreference() {
  const stored = localStorage.getItem("coupon-seva-darkmode");
  if (stored === "1" || (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.body.classList.add("dark-mode");
    els.darkToggle.textContent = "☀️";
    els.darkToggle.title = "Switch to light mode";
  }
}

// ═══════════════════════════════════════════════
// 🌐 MULTI-LANGUAGE (i18n)
// ═══════════════════════════════════════════════

const i18n = {
  en: {
    lang: "हि", totalCoupons: "Total Coupons", assigned: "Assigned", sold: "Sold",
    couponsSettled: "Coupons Settled", hundiSettled: "Hundi Settled", totalSettled: "Total Settled",
    unsettled: "Unsettled Amount", settledCoupons: "Settled Coupons", templeTransfer: "Temple Transfer",
    cashTotal: "Cash Total", login: "Login", logout: "Logout", admin: "Admin",
    viewer: "Viewer", devotee: "Devotee", password: "Password", export: "Export",
    import: "Import", csv: "CSV", dashboard: "Dashboard", setup: "Setup",
    reset: "Reset", devoteeEntry: "Devotee Entry", allCoupons: "All Coupons",
    addDevotee: "Add Devotee", name: "Name", contact: "Contact Number",
    assignCoupons: "Assign Coupons", from: "From", to: "To", assignDate: "Assign Date",
    sendWhatsApp: "Send WhatsApp message", couponSettings: "Coupon Settings",
    totalCouponsLabel: "Total Coupons",
  },
  hi: {
    lang: "EN", totalCoupons: "कुल कूपन", assigned: "आवंटित", sold: "बेचे गए",
    couponsSettled: "कूपन निपटान", hundiSettled: "हुंडी निपटान", totalSettled: "कुल निपटान",
    unsettled: "अनसैटल्ड राशि", settledCoupons: "निपटाए गए कूपन", templeTransfer: "मंदिर हस्तांतरण",
    cashTotal: "नकद कुल", login: "लॉगिन", logout: "लॉगआउट", admin: "प्रशासक",
    viewer: "दर्शक", devotee: "भक्त", password: "पासवर्ड", export: "निर्यात",
    import: "आयात", csv: "CSV", dashboard: "डैशबोर्ड", setup: "सेटअप",
    reset: "रीसेट", devoteeEntry: "भक्त प्रविष्टि", allCoupons: "सभी कूपन",
    addDevotee: "भक्त जोड़ें", name: "नाम", contact: "संपर्क नंबर",
    assignCoupons: "कूपन आवंटित करें", from: "से", to: "तक", assignDate: "आवंटन तिथि",
    sendWhatsApp: "व्हाट्सएप संदेश भेजें", couponSettings: "कूपन सेटिंग्स",
    totalCouponsLabel: "कुल कूपन",
  }
};

let currentLang = "en";

function toggleLanguage() {
  currentLang = currentLang === "en" ? "hi" : "en";
  els.langToggle.textContent = i18n[currentLang].lang;
  try { localStorage.setItem("coupon-seva-lang", currentLang); } catch {}
  showToast(currentLang === "hi" ? "भाषा बदली: हिंदी" : "Language switched: English");
}

function loadLangPreference() {
  const stored = localStorage.getItem("coupon-seva-lang");
  if (stored === "hi" || stored === "en") {
    currentLang = stored;
    els.langToggle.textContent = i18n[currentLang].lang;
  }
}

function t(key) {
  return i18n[currentLang][key] || key;
}

// ═══════════════════════════════════════════════
// 📊 CHARTS (Chart.js)
// ═══════════════════════════════════════════════

let sevaChartInstance = null;
let trendChartInstance = null;
let perfChartInstance = null;

function renderCharts() {
  if (session?.role === "devotee") return;
  if (!els.sevaChart || !els.trendChart || !els.perfChart) return;
  const isAdminOrViewer = session?.role === "admin" || session?.role === "viewer";
  if (!isAdminOrViewer) return;
  if (typeof Chart === "undefined") {
    ensureChartsLoaded();
    return;
  }
  renderSevaChart();
  renderTrendChart();
  renderPerfChart();
}

function renderSevaChart() {
  const sevaMap = {};
  state.coupons.filter(c => c.settled).forEach(c => {
    const seva = c.description || "Others";
    sevaMap[seva] = (sevaMap[seva] || 0) + amountValue(c.amount);
  });
  (state.hundi || []).filter(h => h.settled).forEach(h => {
    sevaMap["Hundi Donation"] = (sevaMap["Hundi Donation"] || 0) + h.amount;
  });

  const labels = Object.keys(sevaMap);
  const data = Object.values(sevaMap);

  if (sevaChartInstance) sevaChartInstance.destroy();

  if (!labels.length) {
    sevaChartInstance = null;
    return;
  }

  const colors = ["#14b8a6","#f59e0b","#ef4444","#8b5cf6","#3b82f6","#10b981","#f97316","#ec4899"];

  sevaChartInstance = new Chart(els.sevaChart, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 12, font: { size: 11 } } }
      }
    }
  });
}

function renderTrendChart() {
  const monthly = {};
  state.coupons.filter(c => c.settled && c.settledAt).forEach(c => {
    const month = c.settledAt.slice(0, 7);
    monthly[month] = (monthly[month] || 0) + amountValue(c.amount);
  });

  const sorted = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([m]) => m);
  const data = sorted.map(([, v]) => v);

  if (trendChartInstance) trendChartInstance.destroy();
  if (!labels.length) { trendChartInstance = null; return; }

  trendChartInstance = new Chart(els.trendChart, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Settled Amount",
        data,
        borderColor: "#14b8a6",
        backgroundColor: "rgba(20,184,166,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { font: { size: 10 }, callback: v => "₹" + v.toLocaleString("en-IN") } }
      }
    }
  });
}

function renderPerfChart() {
  const sorted = [...state.devotees].map(d => {
    const s = devoteeSummary(d.id);
    return { name: d.name, settled: s.settledAmount, pending: s.pendingAmount };
  }).sort((a, b) => b.settled - a.settled).slice(0, 10);

  if (perfChartInstance) perfChartInstance.destroy();
  if (!sorted.length) { perfChartInstance = null; return; }

  perfChartInstance = new Chart(els.perfChart, {
    type: "bar",
    data: {
      labels: sorted.map(s => s.name),
      datasets: [
        { label: "Settled", data: sorted.map(s => s.settled), backgroundColor: "#14b8a6", borderRadius: 4 },
        { label: "Pending", data: sorted.map(s => s.pending), backgroundColor: "#f59e0b", borderRadius: 4 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } } },
      scales: {
        x: { ticks: { font: { size: 9 } } },
        y: { ticks: { font: { size: 10 }, callback: v => "₹" + v.toLocaleString("en-IN") } }
      }
    }
  });
}

// ═══════════════════════════════════════════════
// 📋 AUDIT LOG
// ═══════════════════════════════════════════════

function addAuditEntry(action) {
  if (!state.auditLog) state.auditLog = [];
  state.auditLog.unshift({ action, time: Date.now() });
  if (state.auditLog.length > 200) state.auditLog.length = 200;
  saveState();
}

function renderAuditLog() {
  if (!els.auditLog) return;
  if (session?.role === "devotee") { els.auditLog.innerHTML = ""; return; }

  const logs = (state.auditLog || []).slice(0, 50);
  if (!logs.length) {
    els.auditLog.innerHTML = `<div class="empty with-icon" style="padding:20px"><span class="empty-title">No recent activity</span><span class="empty-desc">Activity will appear here as actions are taken.</span></div>`;
    return;
  }

  els.auditLog.innerHTML = logs.map(entry => `
    <div class="audit-entry">
      <span class="audit-time">${formatAuditTime(entry.time)}</span>
      <span class="audit-action">${escapeHtml(entry.action)}</span>
    </div>
  `).join("");
}

function formatAuditTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

// Patch `saveState` to auto-log key actions (keep wrapper chain)
const _auditOriginalSave = saveState;
saveState = function() {
  _auditOriginalSave();
};
// Direct audit logging from action functions is preferred.

// ═══════════════════════════════════════════════
// 🖨️ PRINT COUPON REPORT
// ═══════════════════════════════════════════════

function printCouponReport() {
  const printWindow = window.open("", "_blank");
  const sorted = [...state.devotees].sort((a, b) => a.name.localeCompare(b.name));
  const rows = sorted.map(d => {
    const assigned = couponsForDevotee(d.id);
    const sold = assigned.filter(isSold);
    const settledAmt = sold.filter(c => c.settled).reduce((s, c) => s + amountValue(c.amount), 0);
    return `<tr>
      <td>${escapeHtml(d.name)}</td>
      <td>${d.contact || "-"}</td>
      <td>${assigned.length}</td>
      <td>${sold.length}</td>
      <td>${assigned.length - sold.length}</td>
      <td>₹${settledAmt.toLocaleString("en-IN")}</td>
    </tr>`;
  }).join("");

  const totalAmt = state.coupons.filter(c => c.settled).reduce((s, c) => s + amountValue(c.amount), 0);

  printWindow.document.write(`
    <html><head><title>Coupon Report</title>
    <style>
      body { font-family: 'Courier New', monospace; padding: 20px; color: #000; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      .date { color: #666; font-size: 12px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
      th { background: #f5f5f5; }
      .total { margin-top: 16px; font-size: 14px; font-weight: bold; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>Coupon Seva Tracker Report</h1>
    <div class="date">Generated: ${new Date().toLocaleString("en-IN")}</div>
    <table>
      <thead><tr><th>Devotee</th><th>Contact</th><th>Issued</th><th>Sold</th><th>Left</th><th>Settled Amt</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">Total Settled Amount: ₹${totalAmt.toLocaleString("en-IN")}</div>
    <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  printWindow.document.close();
}

// ═══════════════════════════════════════════════
// 📲 QR CODE MODAL
// ═══════════════════════════════════════════════

function showQrModal(coupon) {
  let overlay = document.getElementById("qrModalOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "qrModalOverlay";
    overlay.className = "modal-overlay hidden";
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Coupon QR Code">
        <h3>📱 Coupon QR Code</h3>
        <div class="qr-modal-body" id="qrModalBody"></div>
        <div class="inline-fields" style="justify-content:center">
          <button type="button" id="qrModalClose" class="ghost">Close</button>
          <button type="button" id="qrPrintBtn">Print Slip</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("qrModalClose").addEventListener("click", () => overlay.classList.add("hidden"));
    document.getElementById("qrPrintBtn").addEventListener("click", () => {
      const num = overlay.dataset.qrNumber;
      if (num) showPrintSlip(state.coupons[Number(num) - 1]);
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) overlay.classList.add("hidden");
    });
  }

  const body = document.getElementById("qrModalBody");
  body.innerHTML = `<div id="qrCodeContainer"></div><p style="margin-top:12px;font-size:13px;color:var(--muted)">Coupon #${coupon.number}</p>`;
  overlay.dataset.qrNumber = coupon.number;
  overlay.classList.remove("hidden");

  try {
    if (typeof QRCode === "undefined") {
      body.innerHTML = `<p style="color:var(--muted)">Loading QR library...</p>`;
      ensureQrLoaded().then(() => showQrModal(coupon));
      return;
    }
    new QRCode(document.getElementById("qrCodeContainer"), {
      text: `${window.location.origin}${window.location.pathname}?coupon=${coupon.number}`,
      width: 200, height: 200,
      colorDark: "#1a1a1a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  } catch (e) {
    body.innerHTML = `<p style="color:var(--muted)">QR library not loaded.</p>`;
  }
}

// ═══════════════════════════════════════════════
// 🖨️ PRINT COUPON SLIP
// ═══════════════════════════════════════════════

function showPrintSlip(coupon) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Print coupon slip">
      <div class="print-slip-container">
        <div class="print-slip" id="printSlipContent">
          <h2>Coupon Seva</h2>
          <div class="slip-coupon-number">#${coupon.number}</div>
          <div class="slip-divider"></div>
          <div class="slip-row"><span class="slip-label">Buyer</span><span class="slip-value">${escapeHtml(coupon.buyerName || "-")}</span></div>
          <div class="slip-row"><span class="slip-label">Contact</span><span class="slip-value">${escapeHtml(coupon.buyerContact || "-")}</span></div>
          <div class="slip-row"><span class="slip-label">Seva</span><span class="slip-value">${escapeHtml(coupon.description || "-")}</span></div>
          <div class="slip-row"><span class="slip-label">Amount</span><span class="slip-value">${formatMoney(amountValue(coupon.amount))}</span></div>
          <div class="slip-row"><span class="slip-label">Date</span><span class="slip-value">${coupon.soldAt || "-"}</span></div>
          <div class="slip-divider"></div>
          <div style="font-size:11px;color:#666">Devotee: ${escapeHtml(devoteeName(coupon.devoteeId))}</div>
        </div>
        <div class="slip-actions">
          <button type="button" id="doPrintSlip" class="primary">🖨️ Print</button>
          <button type="button" class="ghost" onclick="this.closest('.modal-overlay').remove()">Close</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("doPrintSlip").addEventListener("click", () => {
    window.print();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// ═══════════════════════════════════════════════
// 📲 BULK WHATSAPP
// ═══════════════════════════════════════════════

function bulkWhatsApp() {
  const settledWithContact = state.coupons.filter(c => c.settled && c.buyerContact);
  if (!settledWithContact.length) {
    showToast("No settled coupons with buyer contact numbers.");
    return;
  }

  const confirmed = confirm(`Send invitation to ${settledWithContact.length} settled buyers via WhatsApp? This will open multiple tabs.`);
  if (!confirmed) return;

  const template = state.settings.invitationMessage;
  if (!template) {
    showToast("No invitation template set — Setup → WhatsApp Invitation Template");
    return;
  }

  let count = 0;
  settledWithContact.forEach(coupon => {
    const message = buildInvitationMessage(coupon);
    const url = buildWhatsAppUrl(coupon.buyerContact, message);
    if (url) {
      setTimeout(() => window.open(url, "_blank"), count * 500);
      count++;
    }
  });

  addAuditEntry(`Bulk WhatsApp sent to ${count} buyers`);
  showToast(`Opened ${count} WhatsApp chat(s) — check your browser tabs`);
}

function devoteeBulkWhatsApp(devoteeId) {
  const coupons = couponsForDevotee(devoteeId).filter(c => c.settled && c.buyerContact);
  if (!coupons.length) {
    showToast("No settled coupons with buyer contact numbers for this devotee.");
    return;
  }

  const template = state.settings.invitationMessage;
  if (!template) {
    showToast("No invitation template set — Admin: Setup → WhatsApp Invitation Template");
    return;
  }

  const devotee = state.devotees.find(d => d.id === devoteeId);
  const confirmed = confirm(`Send invitation to ${coupons.length} settled buyer(s) for ${devotee ? devotee.name : "this devotee"} via WhatsApp? This will open multiple tabs.`);
  if (!confirmed) return;

  let count = 0;
  coupons.forEach(coupon => {
    const message = buildInvitationMessage(coupon);
    const url = buildWhatsAppUrl(coupon.buyerContact, message);
    if (url) {
      setTimeout(() => window.open(url, "_blank"), count * 500);
      count++;
    }
  });

  addAuditEntry(`Devotee bulk WhatsApp sent to ${count} buyers for ${devotee ? devotee.name : devoteeId}`);
  showToast(`Opened ${count} WhatsApp chat(s) — check your browser tabs`);
}

// ═══════════════════════════════════════════════
// 📄 BULK PDF RECEIPTS
// ═══════════════════════════════════════════════

async function bulkPdfReceipts() {
  const settled = state.coupons.filter(c => c.settled && c.buyerName);
  if (!settled.length) {
    showToast("No settled coupons with buyer names.");
    return;
  }

  if (typeof html2pdf === "undefined") {
    showToast("Loading PDF library...");
    await ensurePdfLoaded();
    if (typeof html2pdf === "undefined") {
      showToast("PDF library failed to load. Check internet connection.");
      return;
    }
  }

  const container = document.createElement("div");
  container.style.cssText = "padding:20px;font-family:sans-serif";
  container.innerHTML = `
    <h1 style="font-size:18px;margin-bottom:16px">Coupon Receipts</h1>
    ${settled.map(c => `
      <div style="border:1px solid #ccc;border-radius:8px;padding:16px;margin-bottom:12px;page-break-inside:avoid">
        <div style="font-size:14px;font-weight:bold;margin-bottom:8px">Receipt #${c.number}</div>
        <div style="font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <span>Buyer: ${escapeHtml(c.buyerName || "-")}</span>
          <span>Contact: ${escapeHtml(c.buyerContact || "-")}</span>
          <span>Seva: ${escapeHtml(c.description || "-")}</span>
          <span>Amount: ${formatMoney(amountValue(c.amount))}</span>
          <span>Date: ${c.soldAt || "-"}</span>
          <span>Devotee: ${escapeHtml(devoteeName(c.devoteeId))}</span>
        </div>
      </div>
    `).join("")}
  `;

  document.body.appendChild(container);
  html2pdf().from(container).set({
    margin: [10, 10],
    filename: `coupon-receipts-${new Date().toISOString().slice(0,10)}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
  }).save().then(() => {
    document.body.removeChild(container);
    showToast("PDF downloaded");
  }).catch(() => {
    document.body.removeChild(container);
    showToast("PDF generation failed");
  });
}

// ═══════════════════════════════════════════════
// 📅 DATE PRESETS
// ═══════════════════════════════════════════════

function applyDatePreset(preset) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  document.querySelectorAll("[data-preset]").forEach(b => b.classList.remove("active-preset"));
  document.querySelector(`[data-preset="${preset}"]`)?.classList.add("active-preset");

  if (preset === "all") {
    els.settledFromDate.value = "";
    els.settledToDate.value = "";
  } else if (preset === "today") {
    els.settledFromDate.value = todayStr;
    els.settledToDate.value = todayStr;
  } else if (preset === "week") {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay());
    els.settledFromDate.value = start.toISOString().slice(0, 10);
    els.settledToDate.value = todayStr;
  } else if (preset === "month") {
    els.settledFromDate.value = `${yyyy}-${mm}-01`;
    els.settledToDate.value = todayStr;
  } else if (preset === "year") {
    els.settledFromDate.value = `${yyyy}-01-01`;
    els.settledToDate.value = todayStr;
  }

  renderDevotees();
  renderSevaSummary();
}

// ═══════════════════════════════════════════════
// 🔄 SORTABLE TABLE
// ═══════════════════════════════════════════════

function sortTable(column) {
  if (currentSortColumn === column) {
    currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
  } else {
    currentSortColumn = column;
    currentSortOrder = "asc";
  }

  document.querySelectorAll(".sortable").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
  });
  document.querySelector(`.sortable[data-sort="${column}"]`)?.classList.add(`sorted-${currentSortOrder}`);

  currentPage = 1;
  renderAllCoupons();
  renderPagination();
}

// ═══════════════════════════════════════════════
// 📄 PAGINATION
// ═══════════════════════════════════════════════

function renderPagination() {
  if (!els.allPagination) return;
  const totalItems = couponDataCache.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);

  if (totalPages <= 1) {
    els.allPagination.innerHTML = "";
    return;
  }

  let html = "";
  html += `<button class="ghost" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? "disabled" : ""}>‹ Prev</button>`;

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);
  if (startPage > 1) html += `<button class="ghost" onclick="goToPage(1)">1</button>${startPage > 2 ? '<span class="page-info">…</span>' : ""}`;
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="ghost ${i === currentPage ? "active-page" : ""}" onclick="goToPage(${i})">${i}</button>`;
  }
  if (endPage < totalPages) html += `${endPage < totalPages - 1 ? '<span class="page-info">…</span>' : ""}<button class="ghost" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  html += `<button class="ghost" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? "disabled" : ""}>Next ›</button>`;
  html += `<span class="page-info">Page ${currentPage} of ${totalPages} (${totalItems} items)</span>`;

  els.allPagination.innerHTML = html;
}

function goToPage(page) {
  const totalPages = Math.ceil(couponDataCache.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(page, totalPages));
  renderAllCoupons();
  renderPagination();
  els.allCouponsBody.closest(".table-wrap")?.scrollTo({ top: 0, behavior: "smooth" });
}

// ═══════════════════════════════════════════════
// ✅ EVENT CHECK-IN SYSTEM
// ═══════════════════════════════════════════════

let lastCheckinNumber = null;

function canCurrentUserCheckin() {
  if (session?.role === "admin" || session?.role === "viewer") return true;
  if (session?.role === "devotee") {
    const devotee = state.devotees.find(d => d.id === session.devoteeId);
    return devotee ? devotee.canCheckin : false;
  }
  return false;
}

function renderCheckinView() {
  const canCheckin = canCurrentUserCheckin();
  els.checkinInput.closest(".checkin-scanner")?.classList.toggle("hidden", !canCheckin);
  els.checkinResult.classList.toggle("hidden", !canCheckin);
  if (els.checkinActionHeader) els.checkinActionHeader.classList.toggle("hidden", !canCheckin);
  renderCheckinStats();
  renderCheckinReport();
  populateCheckinFilters();
  els.checkinInput.value = "";
  if (canCheckin) els.checkinInput.focus();
  els.checkinResult.className = "checkin-result";
  els.checkinResult.textContent = "";
  els.checkinUndoBtn.style.display = "none";
  lastCheckinNumber = null;
}

function populateCheckinFilters() {
  const sorted = [...state.devotees].sort((a, b) => a.name.localeCompare(b.name));
  els.checkinDevoteeFilter.innerHTML = '<option value="all">All Devotees</option>' +
    sorted.map(d => `<option value="${escapeAttr(d.id)}">${escapeHtml(d.name)}</option>`).join("");

  els.checkinSevaFilter.innerHTML = '<option value="all">All Seva Types</option>' +
    SEVA_TYPES.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
}

function handleCheckin() {
  if (!canCurrentUserCheckin()) { showCheckinError("You don't have permission to check in"); return; }
  const raw = els.checkinInput.value.trim();
  if (!raw) { showCheckinError("Enter a coupon number"); return; }

  const num = Number(raw);
  if (isNaN(num) || num < 1 || num > state.coupons.length) {
    showCheckinError("Invalid coupon number");
    return;
  }

  const coupon = state.coupons[num - 1];
  if (!coupon || !coupon.devoteeId) {
    showCheckinError("Coupon #" + num + " is not assigned to any devotee");
    return;
  }
  if (!isSold(coupon)) {
    showCheckinError("Coupon #" + num + " has not been sold yet");
    return;
  }
  if (coupon.attended) {
    showCheckinError("Coupon #" + num + " is already checked in at " + coupon.attendedAt);
    return;
  }

  coupon.attended = true;
  coupon.attendedAt = todayKey() + " " + new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  markCouponUpdated(coupon);
  saveState();

  lastCheckinNumber = num;
  els.checkinResult.className = "checkin-result success";
  els.checkinResult.innerHTML = `
    <strong>✓ Checked In — Coupon #${num}</strong>
    <div class="coupon-details">
      <span>Buyer: ${escapeHtml(coupon.buyerName || "-")}</span>
      <span>Seva: ${escapeHtml(coupon.description || "-")}</span>
      <span>Devotee: ${escapeHtml(devoteeName(coupon.devoteeId))}</span>
      <span>Time: ${escapeHtml(coupon.attendedAt)}</span>
    </div>
  `;
  els.checkinUndoBtn.style.display = "inline-block";
  els.checkinUndoBtn.textContent = "↩ Undo #" + num;
  els.checkinInput.value = "";
  els.checkinInput.focus();
  renderCheckinStats();
  renderCheckinReport();
  addAuditEntry("checkin: Coupon #" + num + " checked in - " + (coupon.buyerName || "?"));
}

function handleUndoCheckin() {
  if (!canCurrentUserCheckin()) return;
  if (!lastCheckinNumber) return;
  const coupon = state.coupons[lastCheckinNumber - 1];
  if (coupon) {
    coupon.attended = false;
    coupon.attendedAt = "";
    markCouponUpdated(coupon);
    saveState();
    addAuditEntry("checkin_undo: Coupon #" + lastCheckinNumber + " check-in undone");
  }
  els.checkinResult.className = "checkin-result error";
  els.checkinResult.innerHTML = "<strong>↩ Check-in undone for Coupon #" + lastCheckinNumber + "</strong>";
  els.checkinUndoBtn.style.display = "none";
  lastCheckinNumber = null;
  els.checkinInput.value = "";
  els.checkinInput.focus();
  renderCheckinStats();
  renderCheckinReport();
}

function showCheckinError(msg) {
  els.checkinResult.className = "checkin-result error";
  els.checkinResult.textContent = "✕ " + msg;
  els.checkinUndoBtn.style.display = "none";
  els.checkinInput.focus();
}

function renderCheckinStats() {
  const sold = state.coupons.filter(isSold);
  const checkedIn = sold.filter(c => c.attended);
  els.checkinTotalSold.textContent = sold.length.toLocaleString("en-IN");
  els.checkinCheckedIn.textContent = checkedIn.length.toLocaleString("en-IN");
  els.checkinPending.textContent = (sold.length - checkedIn.length).toLocaleString("en-IN");
}

function renderCheckinReport() {
  const devFilter = els.checkinDevoteeFilter?.value || "all";
  const sevaFilter = els.checkinSevaFilter?.value || "all";
  const statusFilter = els.checkinStatusFilter?.value || "all";

  let coupons = state.coupons.filter(isSold);

  if (devFilter !== "all") coupons = coupons.filter(c => c.devoteeId === devFilter);
  if (sevaFilter !== "all") coupons = coupons.filter(c => (c.description || "") === sevaFilter);
  if (statusFilter === "checked_in") coupons = coupons.filter(c => c.attended);
  else if (statusFilter === "not_checked_in") coupons = coupons.filter(c => !c.attended);

  const searchQuery = els.checkinSearch?.value.trim();
  if (searchQuery) {
    const searchNum = Number(searchQuery);
    if (!isNaN(searchNum)) coupons = coupons.filter(c => c.number === searchNum);
    else coupons = coupons.filter(c => String(c.number).includes(searchQuery));
  }

  els.checkinCount.textContent = "Coupons: " + coupons.length.toLocaleString("en-IN");

  const canCheckin = canCurrentUserCheckin();

  els.checkinReportBody.innerHTML = coupons.map(c => {
    const attended = c.attended;
    return `
      <tr>
        <td>#${c.number}</td>
        <td>${escapeHtml(c.buyerName || "-")}</td>
        <td>${escapeHtml(c.buyerContact || "-")}</td>
        <td>${escapeHtml(devoteeName(c.devoteeId))}</td>
        <td>${escapeHtml(c.description || "-")}</td>
        <td><span class="attended-badge ${attended ? '' : 'missed'}">${attended ? "✓ Checked In" : "○ Not Yet"}</span></td>
        <td>${attended ? escapeHtml(c.attendedAt) : "-"}</td>
        ${canCheckin ? `
        <td class="no-print">
          ${attended
            ? `<button class="ghost" type="button" onclick="undoCheckinFromReport(${c.number})">Undo</button>`
            : `<button class="ghost" type="button" onclick="checkinFromReport(${c.number})">Check In</button>`
          }
        </td>` : ""}
      </tr>
    `;
  }).join("") || '<tr><td colspan="8"><div class="empty">No coupons match the filters.</div></td></tr>';
}

function checkinFromReport(num) {
  els.checkinInput.value = num;
  handleCheckin();
}

function undoCheckinFromReport(num) {
  lastCheckinNumber = num;
  handleUndoCheckin();
}

// ═══════════════════════════════════════════════
// 🔢 RECEIPT AUTO-GENERATION
// ═══════════════════════════════════════════════

function isAutoReceiptEnabled() {
  return Boolean(els.autoReceiptCheck?.checked);
}

function loadAutoReceiptSetting() {
  const val = state.settings.autoReceipt;
  if (els.autoReceiptCheck) els.autoReceiptCheck.checked = Boolean(val);
}

// Patch assignCoupons to save the setting
const _origUpdateTotalCoupons = updateTotalCoupons;
updateTotalCoupons = function(event) {
  if (els.autoReceiptCheck) {
    state.settings.autoReceipt = els.autoReceiptCheck.checked;
  }
  _origUpdateTotalCoupons(event);
};

// ═══════════════════════════════════════════════
// 🗄️ INDEXEDDB FALLBACK
// ═══════════════════════════════════════════════

const DB_NAME = "CouponSevaTrackerDB";
const DB_STORE = "appState";

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

function saveToIndexedDB(data) {
  openIndexedDB().then(db => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put({ id: "state", data, savedAt: Date.now() });
    tx.oncomplete = () => db.close();
  }).catch(() => {});
}

function loadFromIndexedDB() {
  return openIndexedDB().then(db => {
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get("state");
      req.onsuccess = () => { db.close(); resolve(req.result?.data || null); };
      req.onerror = () => { db.close(); resolve(null); };
    });
  }).catch(() => null);
}

// Wrap saveState to also write to IndexedDB
const _indexedDBSave = saveState;
saveState = function() {
  _indexedDBSave();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length > 3000000) {
      saveToIndexedDB(state);
      // Trim localStorage to stay under quota
      try {
        const trimmed = JSON.stringify(state);
        if (trimmed.length > 4000000) {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch(e) {}
    }
  } catch(e) {}
};

// ═══════════════════════════════════════════════
// 🖼️ BETTER EMPTY STATES — hook into renderEmpty
// ═══════════════════════════════════════════════

// (Empty state styling is handled in CSS via .with-icon classes)

// ═══════════════════════════════════════════════
// 🚀 DYNAMIC SCRIPT LOADER
// ═══════════════════════════════════════════════

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.body.appendChild(s);
  });
}

let _chartsLoaded = false;
let _pdfLoaded = false;
let _qrLoaded = false;

function ensureChartsLoaded() {
  if (typeof Chart !== "undefined") { _chartsLoaded = true; return Promise.resolve(); }
  if (_chartsLoaded) return Promise.resolve();
  return loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js")
    .then(() => { _chartsLoaded = true; renderCharts(); })
    .catch(() => {});
}

function ensurePdfLoaded() {
  if (typeof html2pdf !== "undefined") { _pdfLoaded = true; return Promise.resolve(); }
  if (_pdfLoaded) return Promise.resolve();
  return loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.3/html2pdf.bundle.min.js")
    .then(() => { _pdfLoaded = true; })
    .catch(() => {});
}

function ensureQrLoaded() {
  if (typeof QRCode !== "undefined") { _qrLoaded = true; return Promise.resolve(); }
  if (_qrLoaded) return Promise.resolve();
  return loadScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js")
    .then(() => { _qrLoaded = true; })
    .catch(() => {});
}

// ═══════════════════════════════════════════════
// 🚀 INIT NEW FEATURES
// ═══════════════════════════════════════════════

function initNewFeatures() {
  loadDarkModePreference();
  loadLangPreference();
  loadAutoReceiptSetting();
  ensureChartsLoaded();
}

// Defer init until after Firebase loads
setTimeout(() => {
  initNewFeatures();
  try {
    loadFromIndexedDB().then(data => {
      if (data && !hasStateData(state)) {
        Object.assign(state, data);
        saveState();
        render();
      }
    });
  } catch(e) {}
}, 500);

// ═══════════════════════════════════════════════
// 🛡️ PWA: Register service worker + manifest
// ═══════════════════════════════════════════════

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
