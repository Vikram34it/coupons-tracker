const DEFAULT_TOTAL_COUPONS = 3000;
const STORAGE_KEY = "coupon-seva-tracker-v1";
const AUTH_KEY = "coupon-seva-session-v1";
const DEFAULT_ADMIN_PASSWORD = "hare krishna";
const IDB_NAME = "coupon-seva-tracker-idb";
const IDB_STORE = "appState";
const IDB_KEY = "state";

let db = null;

// ✅ Monotonic version stamp — always strictly increasing, even within the same millisecond
let _versionSeq = 0;
let _versionLastMs = 0;
function getVersionStamp() {
  const now = Date.now();
  if (now > _versionLastMs) {
    _versionLastMs = now;
    _versionSeq = 0;
  } else {
    _versionSeq++;
  }
  // Encode as a sortable float: milliseconds + sub-ms counter
  return now * 10000 + _versionSeq;
}

function openIDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE);
      }
    };
  });
}

async function idbGet() {
  try {
    const database = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(data) {
  try {
    const database = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(data, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
  }
}

const state = defaultState();
let firebaseRestoreDone = false;
let session = loadSession();
let activeDevoteeTab = "pending";
let activeAdminTab = "dashboard";
let isEditing = false;
let pendingFirebaseData = null;
let saveTimer = null;
const els = {};
let idbInitialized = false;

window.addEventListener("load", async () => {
  cacheElements();
  bindEvents();
  renderSelectors();
  render();

  // ✅ Load from IndexedDB as fast fallback while Firebase connects
  idbGet().then(idbData => {
    if (idbData && Array.isArray(idbData.devotees) && Array.isArray(idbData.coupons)) {
      const totalCoupons = positiveInteger(idbData.settings?.totalCoupons) || idbData.coupons.length || DEFAULT_TOTAL_COUPONS;
      state.settings = {
        adminPassword: idbData.settings?.adminPassword || DEFAULT_ADMIN_PASSWORD,
        totalCoupons,
        invitationMessage: idbData.settings?.invitationMessage || "",
        viewerPassword: idbData.settings?.viewerPassword || ""
      };
      state.devotees = idbData.devotees.map(normalizeDevotee);
      state.coupons = normalizeCoupons(idbData.coupons, totalCoupons);
      // ✅ Normalize hundi settled flag from IDB too
      state.hundi = Array.isArray(idbData.hundi) ? idbData.hundi.map(h => ({
        id: h.id, devoteeId: h.devoteeId, amount: h.amount,
        date: h.date, settled: Boolean(h.settled), _updated: h._updated
      })) : [];
      state._version = idbData._version || 0;
      localVersion = state._version;
      renderSelectors();
      render();
      idbInitialized = true;
    } else {
      idbInitialized = true;
    }
  });

  // ✅ Track editing state: set true when any input is focused
  document.addEventListener("focusin", (e) => {
    if (e.target.matches("input, textarea, select")) {
      isEditing = true;
    }
  });

  document.addEventListener("focusout", (e) => {
    if (!e.target.matches("input, textarea, select")) return;

    const field = e.target;
    const card = field.closest("[data-coupon-number]");

    // ✅ Capture coupon card field value immediately on blur
    if (card && field.matches("[data-field]")) {
      const couponNum = Number(card.dataset.couponNumber);
      const coupon = state.coupons[couponNum - 1];
      if (coupon && field.dataset.field) {
        coupon[field.dataset.field] = field.value.trimStart();
        coupon._updated = ts();
      }
    }

    // ⏳ Small delay to allow TAB to move focus to the next field first
    setTimeout(() => {
      const active = document.activeElement;

      // If focus is still on an input — user is tabbing between fields, do nothing
      if (active && active.matches("input, textarea, select")) return;

      // Focus has left all inputs — save and unlock Firebase updates
      clearTimeout(saveTimer);
      isEditing = false;   // ✅ Always reset, not just for coupon cards
      saveState();
      applyPendingFirebaseData(); // ✅ Apply any queued Firebase updates now

    }, 150);
  });

  // ✅ Save on page unload
  window.addEventListener("beforeunload", () => {
    clearTimeout(saveTimer);
    isEditing = false;
    saveState();
  });

  // Wait until Firebase is ready then connect
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
      totalCoupons,
      invitationMessage: "",
      viewerPassword: ""
    },
    devotees: [],
    coupons: makeCoupons(totalCoupons),
    hundi: []
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
        totalCoupons,
        invitationMessage: parsed.settings?.invitationMessage || "",
        viewerPassword: parsed.settings?.viewerPassword || ""
      },
      devotees: parsed.devotees.map(normalizeDevotee),
      coupons,
      hundi: Array.isArray(parsed.hundi) ? parsed.hundi.map(h => ({ settled: false, ...h })) : []
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  // NOTE: Firebase override below replaces this at runtime.
  // This base version is only called directly before Firebase initializes.
  state._version = getVersionStamp();
  state._lastSync = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  idbPut(JSON.parse(JSON.stringify(state)));
  // Push to Firebase if ready (will be a no-op before initFirebaseSync runs)
  if (typeof _pushToFirebase === "function") _pushToFirebase();
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

  state.coupons
    .filter(c => c.settled && inSettlementPeriod(c, period))
    .forEach(coupon => {
      const seva = coupon.description || "Others";

      if (!sevaMap[seva]) {
        sevaMap[seva] = { count: 0, amount: 0 };
      }

      sevaMap[seva].count += 1;
      sevaMap[seva].amount += amountValue(coupon.amount);
    });

  (state.hundi || []).filter(h => h.settled && inSettlementPeriod({ settledAt: h.date }, period)).forEach(h => {
    const seva = "Hundi Donation";

    if (!sevaMap[seva]) {
      sevaMap[seva] = { count: 0, amount: 0 };
    }

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
    "logoutBtn", "userBadge", "syncBadge", "csvBtn", "exportBtn", "importFile", "totalCoupons", "assignedCoupons", "soldCoupons", "moneyReceived", "settledCoupons", "unsettledMoney", "templeTransferMoney",
    "devoteeForm", "devoteeName", "devoteeContact", "devoteePassword", "assignForm", "assignDevotee", "assignFrom",
    "assignTo", "assignDate", "assignHint", "couponSettingsForm", "totalCouponInput", "resetCouponForm", "resetCouponNumber", "resetDevotee", "resetCouponList",
    "selectAllResetCouponsBtn", "clearResetSelectionBtn", "resetSelectedCouponsBtn", "resetDevoteeCouponsBtn", "resetAllCouponsBtn",
    "adminPasswordForm", "adminPassword", "viewerPasswordForm", "viewerPasswordInput",
    "invitationForm", "invitationMessageInput", "previewInvitationBtn", "invitationSavedBadge",
    "adminPeriodSummary", "devoteeSearch", "devoteeStatusFilter", "dashboardDevoteeFilter", "settledFromDate", "settledToDate", "devoteeList", "entryDevotee", "devoteeStats", "entrySearch",
    "entryStatus", "entryList", "allSearch", "allStatus", "allDevoteeFilter", "devoteePendingDisplay", "sevaSummary", "allCouponsBody", "toast",
    "bulkSelectAll", "bulkSettleBtn"
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
  els.resetCouponForm.addEventListener("submit", resetOneCoupon);
  els.resetDevotee.addEventListener("change", renderResetCouponList);
  els.selectAllResetCouponsBtn.addEventListener("click", selectAllResetCoupons);
  els.clearResetSelectionBtn.addEventListener("click", clearResetSelection);
  els.resetSelectedCouponsBtn.addEventListener("click", resetSelectedCoupons);
  els.resetDevoteeCouponsBtn.addEventListener("click", resetDevoteeCoupons);
  els.resetAllCouponsBtn.addEventListener("click", resetAllCoupons);
  els.adminPasswordForm.addEventListener("submit", updateAdminPassword);
  els.viewerPasswordForm.addEventListener("submit", updateViewerPassword);
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
  els.allSearch.addEventListener("input", renderAllCoupons);
  els.allStatus.addEventListener("change", renderAllCoupons);
  els.exportBtn.addEventListener("click", exportBackup);
  els.csvBtn.addEventListener("click", exportCsv);
  els.importFile.addEventListener("change", importBackup);
  els.allDevoteeFilter.addEventListener("change", () => {
    renderAllCoupons();
    updateDevoteePendingDisplay();
  });

  els.bulkSelectAll?.addEventListener("change", () => {
    els.allCouponsBody?.querySelectorAll(".bulk-cb:not(:disabled)").forEach(cb => {
      cb.checked = els.bulkSelectAll.checked;
    });
  });

  els.bulkSettleBtn?.addEventListener("click", bulkSettleSelected);

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
}

function logout() {
  saveSession(null);
  render();
  showToast("Logged out");
}

function renderLoginRole() {
  const isDevotee = els.loginRole.value === "devotee";
  if (els.loginDevoteeLabel) els.loginDevoteeLabel.classList.toggle("hidden", !isDevotee);
}

function addDevotee(event) {
  event.preventDefault();
  const name = els.devoteeName.value.trim();
  const contact = els.devoteeContact.value.trim();
  const password = els.devoteePassword.value.trim();
  if (!name) return;
  if (password.length < 4) {
    showToast("Use at least 4 characters for devotee password");
    return;
  }

  state.devotees.push({
    id: newId(),
    name,
    contact,
    pin: password,
    _updated: ts()
  });

  els.devoteeForm.reset();
  saveState();
  render();
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
  state.coupons[number - 1] = emptyCoupon(number);
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

  state.coupons = makeCoupons(couponTotal());
  saveState();
  render();
  showToast("All coupons reset");
}

function resetCouponNumbers(numbers, message) {
  if (!window.confirm(message)) return;
  numbers.forEach((number) => {
    state.coupons[number - 1] = emptyCoupon(number);
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

  const devotee = state.devotees.find(d => d.id === devoteeId);
  const assignedCoupons = [];

  state.coupons.forEach((coupon) => {
    if (coupon.number >= from && coupon.number <= to) {
      coupon.devoteeId = devoteeId;
      coupon.assignedAt = assignedAt;
      coupon._updated = ts();
      assignedCoupons.push(coupon.number);
    }
  });

  els.assignForm.reset();
  els.assignHint.textContent = "";
  saveState();
  render();

  // Send WhatsApp message to devotee
  if (devotee && devotee.contact) {
    const sortedNumbers = assignedCoupons.sort((a, b) => a - b);
    const ranges = summarizeCouponRanges(sortedNumbers);

    const message = `Hare Krishna 🙏

Dear ${devotee.name},

You have been assigned new coupons for Seva:

🎟 Coupons Assigned: ${assignedCoupons.length}
📋 Coupon Numbers: ${ranges.join(", ")}

Please login and start entering buyer details:
https://vikram34it.github.io/coupons-tracker/

Thank you for your service 🙏`;

    const phone = devotee.contact.replace(/\D/g, "");
    const validPhone = phone.length === 10 || (phone.length === 12 && phone.startsWith("91"));
    if (validPhone) {
      const phoneToUse = phone.length === 10 ? phone : phone.slice(-10);
      const url = `https://wa.me/91${phoneToUse}?text=${encodeURIComponent(message)}`;
      const sendWA = window.confirm(`Coupons assigned! Send WhatsApp notification to ${devotee.name}?`);
      if (sendWA) {
        window.open(url, "_blank");
      }
    } else {
      showToast("Invalid phone number - please update contact in devotee details");
    }
  }

  showToast(`Assigned coupons ${from} to ${to}`);
}

function render() {
  validateSession();
  renderSelectors();
  renderAllDevoteeFilter();
  renderDashboardDevoteeFilter();
  updateDevoteePendingDisplay();
  applyRoleAccess();
  renderStats();
  renderDevotees();
  renderSevaSummary();
  renderResetCouponList();
  renderEntryList();
  renderAllCoupons();
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
  els.assignDevotee.innerHTML = empty + options;

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
  // Import visible to admin and viewer
  els.importFile.closest(".file-label").classList.toggle("hidden", !isAdmin && !isViewer);

  // Devotee entry dropdown
  els.entryDevotee.disabled = isDevotee;
  els.entryStatus.classList.toggle("hidden", isDevotee);
  if (isDevotee) els.entryStatus.value = "all";

  // All Coupons tab — visible to admin & viewer
  document.querySelector('[data-view="allCouponsView"]').classList.toggle("hidden", !isAdmin && !isViewer);

  // Devotee Entry tab — hidden for viewer
  document.querySelector('[data-view="devoteeView"]')?.classList.toggle("hidden", isViewer);

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

  // Devotee: land on devotee entry view
  if (isDevotee) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelector('[data-view="devoteeView"]').classList.add("active");
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    document.getElementById("devoteeView").classList.add("active");
  }
}

function renderStats() {
  const period = settlementPeriod();
  const assigned = state.coupons.filter((coupon) => coupon.devoteeId && inSettlementPeriod(coupon, period)).length;
  const sold = state.coupons.filter(isSold).filter(c => inSettlementPeriod(c, period)).length;
  const settled = state.coupons.filter((coupon) => coupon.settled && inSettlementPeriod(coupon, period)).length;

  // Only settled coupons + hundi count as received
  const settledMoney = state.coupons
    .filter(c => c.settled && inSettlementPeriod(c, period))
    .reduce((sum, c) => sum + amountValue(c.amount), 0);
  const hundiMoney = (state.hundi || []).filter(h => h.settled && inSettlementPeriod({ settledAt: h.date }, period)).reduce((sum, h) => sum + h.amount, 0);

  // Unsettled = sold but not yet settled
  const unsettledMoney = state.coupons
    .filter(c => isSold(c) && !c.settled)
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  const templeTransfer = state.coupons
    .filter(c => c.paymentMode === "temple_transfer")
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  els.totalCoupons.textContent = couponTotal().toLocaleString("en-IN");
  els.assignedCoupons.textContent = assigned.toLocaleString("en-IN");
  els.soldCoupons.textContent = sold.toLocaleString("en-IN");
  els.moneyReceived.textContent = formatMoney(settledMoney + hundiMoney);
  els.settledCoupons.textContent = settled.toLocaleString("en-IN");
  if (els.unsettledMoney) els.unsettledMoney.textContent = formatMoney(unsettledMoney);
  if (els.templeTransferMoney) els.templeTransferMoney.textContent = formatMoney(templeTransfer);
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
          <span class="small-stat"> settled</span>
        </span>

        <span>
          <strong>${formatMoney(summary.pendingAmount)}</strong>
          <span class="small-stat"> pending</span>
        </span>

        ${session?.role === "viewer" ? "" : `
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
        devotee._updated = ts();

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

        const assignedCoupons = couponsForDevotee(devotee.id);
        const assignedCount = assignedCoupons.length;
        const couponNumbers = assignedCoupons.map(c => c.number).sort((a, b) => a - b);
        const couponRanges = summarizeCouponRanges(couponNumbers);

        const message =
          `Hare Krishna 🙏

${devotee.name},

Here is your seva summary:

🔐 PIN: ${devotee.pin || "Not set"}

🎟 Coupons Assigned: ${assignedCount}
📋 Coupon Numbers: ${couponRanges.join(", ")}
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

        const validPhone = phone.length === 10 || (phone.length === 12 && phone.startsWith("91"));
        if (!validPhone) {
          showToast("Invalid phone number - please update contact in devotee details");
          return;
        }

        const phoneToUse = phone.length === 10 ? phone : phone.slice(-10);
        const url =
          `https://wa.me/91${phoneToUse}?text=${encodeURIComponent(message)}`;

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

        const cleaned = newContact.replace(/\D/g, "");

        if (cleaned.length !== 10) {
          showToast("Enter valid 10-digit mobile number");
          return;
        }

        devotee.contact = cleaned;
        devotee._updated = ts();

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
    }
  });

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
                </td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${session?.role === "admin" ? 3 : 2}">No entries</td></tr>`
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
        hundi._updated = ts();
        saveState();
        renderEntryList();
        renderStats();
        renderDevoteeStats(hundi.devoteeId);
        renderSevaSummary();
        showToast(hundi.settled ? "Hundi settled" : "Hundi marked pending");
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
        _updated: ts()
      });

      saveState();
      renderEntryList();
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

  if (activeDevoteeTab === "pending") coupons = coupons.filter((coupon) => !isSold(coupon));
  if (activeDevoteeTab === "sold") coupons = coupons.filter((coupon) => isSold(coupon) && !coupon.settled);
  if (activeDevoteeTab === "settled") coupons = coupons.filter((coupon) => coupon.settled);
  if (activeDevoteeTab === "settled") {
    const isAdmin = session?.role === "admin";
    const hasTemplate = Boolean(state.settings.invitationMessage);
    const noTemplateBanner = !hasTemplate
      ? `<div style="background:#fff4df;border:1px solid #f0c46a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#7a5300">
           ⚠️ No invitation template set. <strong>Admin: go to Setup → WhatsApp Invitation Template</strong> to create one.
         </div>`
      : "";

    els.entryList.innerHTML = `
    ${noTemplateBanner}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coupon</th>
            <th>Buyer</th>
            <th>Contact</th>
            <th>Amount</th>
            <th>Seva</th>
            <th>Receipt</th>
            <th>Payment Mode</th>
            <th>Settled Date</th>
            ${isAdmin ? "<th>Actions</th>" : ""}
            <th>Send Invite</th>
          </tr>
        </thead>
        <tbody>
          ${coupons.map(coupon => `
            <tr>
              <td>#${coupon.number}</td>
              <td>${escapeHtml(coupon.buyerName || "-")}</td>
              <td>${escapeHtml(coupon.buyerContact || "-")}</td>
              <td>${formatMoney(coupon.amount)}</td>
              <td>${escapeHtml(coupon.description || "-")}</td>
              <td>${escapeHtml(coupon.receiptNumber || "-")}</td>
              <td>${coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"}</td>
              <td>${escapeHtml(coupon.settledAt || "-")}</td>
              ${isAdmin ? `
              <td>
                <button class="ghost" type="button" data-unsettle-coupon="${coupon.number}">Unsettle</button>
              </td>` : ""}
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

    // Wire up send buttons
    els.entryList.querySelectorAll("[data-wa-coupon]").forEach(btn => {
      btn.addEventListener("click", () => {
        const coupon = state.coupons[Number(btn.dataset.waCoupon) - 1];
        openWhatsAppForBuyer(coupon);
      });
    });

    // Wire up unsettle button for admin
    els.entryList.querySelectorAll("[data-unsettle-coupon]").forEach(btn => {
      btn.addEventListener("click", () => {
        const coupon = state.coupons[Number(btn.dataset.unsettleCoupon) - 1];
        if (!coupon) return;
        coupon.settled = false;
        coupon.settledAt = "";
        coupon._updated = ts();
        saveState();
        renderEntryList();
        renderStats();
        renderDevoteeStats(els.entryDevotee.value);
        showToast(`Coupon #${coupon.number} marked as unsettled`);
      });
    });

    return; // 🔥 VERY IMPORTANT (stops card rendering)
  }

  // ✅ Sold tab — show form view (cards) with admin settle option
  if (activeDevoteeTab === "sold") {
    const isAdmin = session?.role === "admin";
    const hasTemplate = Boolean(state.settings.invitationMessage);
    const noTemplateBanner = !hasTemplate
      ? `<div style="background:#fff4df;border:1px solid #f0c46a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#7a5300">
           ⚠️ No invitation template set. <strong>Admin: go to Setup → WhatsApp Invitation Template</strong> to create one.
         </div>`
      : "";

    if (!coupons.length) {
      els.entryList.innerHTML = `${noTemplateBanner}<div class="empty">No sold (unsettled) coupons found.</div>`;
      return;
    }

    els.entryList.innerHTML = `
    ${noTemplateBanner}
    ${coupons.map((coupon) => `
      <article class="coupon-card" data-coupon-number="${coupon.number}">
        <div class="coupon-number">
          <strong>#${coupon.number}</strong>
          <span class="status sold">Sold</span>
          <span class="status pending">Not Settled</span>
          ${isAdmin ? `<button type="button" class="ghost" style="margin-left:auto;font-size:12px;padding:4px 8px" data-settle-coupon="${coupon.number}">Mark Settled</button>` : ""}
        </div>
        <div class="coupon-fields">
          <label>
            Buyer Name
            <input data-field="buyerName" autocomplete="name" value="${escapeAttr(coupon.buyerName)}" placeholder="Name">
          </label>
          <label>
            Contact Number
            <input data-field="buyerContact" type="tel" autocomplete="tel" value="${escapeAttr(coupon.buyerContact)}" placeholder="Phone">
          </label>
          <label>
            Amount Received
            <input data-field="amount" type="number" min="0" step="1" value="${escapeAttr(coupon.amount)}" placeholder="0">
          </label>
          <label>
            Assigned To
            <input value="${escapeAttr(devoteeName(coupon.devoteeId))}" disabled>
          </label>
          <label class="half">
            Seva Type
            <select data-field="description">
              <option value="">Select Seva</option>
              <option value="Deepa Seva" ${coupon.description === "Deepa Seva" ? "selected" : ""}>Deepa Seva</option>
              <option value="Chenetha Seva" ${coupon.description === "Chenetha Seva" ? "selected" : ""}>Chenetha Seva</option>
              <option value="Sumangala Subhadram" ${coupon.description === "Sumangala Subhadram" ? "selected" : ""}>Sumangala Subhadram</option>
              <option value="Panchopachara Seva" ${coupon.description === "Panchopachara Seva" ? "selected" : ""}>Panchopachara Seva</option>
              <option value="General Donation" ${coupon.description === "General Donation" ? "selected" : ""}>General Donation</option>
              <option value="Prasadam Donation" ${coupon.description === "Prasadam Donation" ? "selected" : ""}>Prasadam Donation</option>
              <option value="Donation in Kind" ${coupon.description === "Donation in Kind" ? "selected" : ""}>Donation in Kind</option>
            </select>
          </label>
          <label class="half">
            Payment Mode
            <select data-field="paymentMode">
              <option value="cash" ${(!coupon.paymentMode || coupon.paymentMode === "cash") ? "selected" : ""}>Cash</option>
              <option value="temple_transfer" ${coupon.paymentMode === "temple_transfer" ? "selected" : ""}>Temple Transfer</option>
            </select>
          </label>
        </div>
      </article>
    `).join("")}
    `;

    // Wire up field changes
els.entryList.querySelectorAll("[data-field]").forEach((field) => {
      field.addEventListener("change", updateCouponField);
      // ✅ Save immediately on blur to prevent data loss
      field.addEventListener("blur", () => {
        const card = field.closest("[data-coupon-number]");
        if (!card) return;
        const couponNum = Number(card.dataset.couponNumber);
        const coupon = state.coupons[couponNum - 1];
        if (coupon && field.dataset.field) {
          coupon[field.dataset.field] = field.value.trimStart();
          clearTimeout(saveTimer);
          saveState();
        }
      });
    });

    // ✅ Update status when moving between coupon cards
    els.entryList.querySelectorAll(".coupon-card").forEach(card => {
      card.addEventListener("focusout", (e) => {
        if (!card.contains(document.activeElement)) {
          const couponNum = Number(card.dataset.couponNumber);
          const coupon = state.coupons[couponNum - 1];
          const statusBadge = card.querySelector(".coupon-number .status");
          if (statusBadge && isSold(coupon)) {
            statusBadge.className = "status sold";
            statusBadge.textContent = "Sold";
          }
        }
      });
    });

    // Wire up settle button for admin
    els.entryList.querySelectorAll("[data-settle-coupon]").forEach(btn => {
      btn.addEventListener("click", () => {
        const coupon = state.coupons[Number(btn.dataset.settleCoupon) - 1];
        if (!coupon) return;
        coupon.settled = true;
        coupon.settledAt = todayKey();
        coupon._updated = ts();
        saveState();
        renderEntryList();
        renderStats();
        renderDevoteeStats(els.entryDevotee.value);
        showToast(`Coupon #${coupon.number} marked as settled`);
      });
    });

    // Buyer contact validation
    els.entryList.querySelectorAll("[data-field='buyerContact']").forEach((input) => {
      input.addEventListener("blur", () => {
        const val = input.value.replace(/\D/g, "");
        if (val && val.length !== 10) {
          showToast("Contact number should be 10 digits");
        }
      });
    });

    return;
  }

  if (status === "unsettled") coupons = coupons.filter((coupon) => !coupon.settled);
  if (query) coupons = coupons.filter((coupon) => couponSearchText(coupon).includes(query));

  if (!coupons.length) {
    const msg = activeDevoteeTab === "settled" ? "No settled coupons found."
      : activeDevoteeTab === "sold" ? "No sold coupons found."
      : "No pending coupons found.";
    els.entryList.innerHTML = `<div class="empty">${msg}</div>`;
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
          <label>
            Assigned To
            <input value="${escapeAttr(devoteeName(coupon.devoteeId))}" disabled>
          </label>
          <label class="half">
            Seva Type
            <select data-field="description" ${locked}>
              <option value="">Select Seva</option>
              <option value="Deepa Seva" ${coupon.description === "Deepa Seva" ? "selected" : ""}>Deepa Seva</option>
              <option value="Chenetha Seva" ${coupon.description === "Chenetha Seva" ? "selected" : ""}>Chenetha Seva</option>
              <option value="Sumangala Subhadram" ${coupon.description === "Sumangala Subhadram" ? "selected" : ""}>Sumangala Subhadram</option>
              <option value="Panchopachara Seva" ${coupon.description === "Panchopachara Seva" ? "selected" : ""}>Panchopachara Seva</option>
              <option value="General Donation" ${coupon.description === "General Donation" ? "selected" : ""}>General Donation</option>
              <option value="Prasadam Donation" ${coupon.description === "Prasadam Donation" ? "selected" : ""}>Prasadam Donation</option>
              <option value="Donation in Kind" ${coupon.description === "Donation in Kind" ? "selected" : ""}>Donation in Kind</option>
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
      field.addEventListener("change", updateCouponField);
    });

    // ✅ Update status when moving between coupon cards
    els.entryList.querySelectorAll(".coupon-card").forEach(card => {
      card.addEventListener("focusout", (e) => {
        if (!card.contains(document.activeElement)) {
          const couponNum = Number(card.dataset.couponNumber);
          const coupon = state.coupons[couponNum - 1];
          const statusBadge = card.querySelector(".coupon-number .status");
          if (statusBadge && isSold(coupon)) {
            statusBadge.className = "status sold";
            statusBadge.textContent = "Sold";
          }
        }
      });
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
  if (query) coupons = coupons.filter((coupon) => couponSearchText(coupon).includes(query));

  els.allCouponsBody.innerHTML = coupons.map((coupon) => {
    const isViewer = session?.role === "viewer";
    return `
    <tr>
      <td><input type="checkbox" class="bulk-cb" data-num="${coupon.number}" ${coupon.settled ? "disabled" : ""}></td>
      <td>#${coupon.number}</td>
      <td>${escapeHtml(devoteeName(coupon.devoteeId) || "-")}</td>
      <td>${escapeHtml(coupon.assignedAt || "-")}</td>
      <td>${escapeHtml(coupon.buyerName || "-")}</td>
      <td>${escapeHtml(coupon.buyerContact || "-")}</td>
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

  // Wire up WhatsApp send buttons in All Coupons table (admin)
  els.allCouponsBody.querySelectorAll("[data-wa-coupon]").forEach(btn => {
    btn.addEventListener("click", () => {
      const coupon = state.coupons[Number(btn.dataset.waCoupon) - 1];
      openWhatsAppForBuyer(coupon);
    });
  });
}

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
  coupon.settledAt = coupon.settled ? todayKey() : "";
  coupon._updated = ts();

  saveState();

  // ✅ Preserve scroll position and filters
  const tableWrap = els.allCouponsBody.closest(".table-wrap");
  const scrollTop = tableWrap ? tableWrap.scrollTop : 0;
  const savedDevoteeFilter = els.allDevoteeFilter ? els.allDevoteeFilter.value : "all";
  const savedStatus = els.allStatus ? els.allStatus.value : "all";

  renderStats();
  renderDevotees();
  renderSevaSummary();
  updateDevoteePendingDisplay();

  // ✅ Restore filters then render table once
  if (els.allDevoteeFilter && savedDevoteeFilter) els.allDevoteeFilter.value = savedDevoteeFilter;
  if (els.allStatus && savedStatus) els.allStatus.value = savedStatus;
  renderAllCoupons();

  if (tableWrap) tableWrap.scrollTop = scrollTop;

  showToast(
    coupon.settled
      ? `✓ Coupon ${coupon.number} settled`
      : `Coupon ${coupon.number} marked pending`
  );
}

function bulkSettleSelected() {
  if (session?.role !== "admin") {
    showToast("Only admin can settle coupons");
    return;
  }

  const checkboxes = els.allCouponsBody?.querySelectorAll(".bulk-cb:checked") || [];
  if (!checkboxes.length) {
    showToast("Select coupons to settle");
    return;
  }

  const toSettle = [];
  checkboxes.forEach(cb => {
    const num = Number(cb.dataset.num);
    const coupon = state.coupons[num - 1];
    if (coupon && !coupon.settled) toSettle.push(coupon);
  });

  if (!toSettle.length) {
    showToast("All selected coupons are already settled");
    return;
  }

  const confirmed = window.confirm(`Mark ${toSettle.length} coupon(s) as settled?`);
  if (!confirmed) return;

  toSettle.forEach(c => {
    c.settled = true;
    c.settledAt = c.settledAt || todayKey();
    c._updated = ts();
  });

  const tableWrap = els.allCouponsBody?.closest(".table-wrap");
  const scrollTop = tableWrap ? tableWrap.scrollTop : 0;
  const savedDevotee = els.allDevoteeFilter?.value || "all";
  const savedStatus = els.allStatus?.value || "all";

  saveState();
  renderStats();
  renderDevotees();
  renderSevaSummary();
  updateDevoteePendingDisplay();

  if (els.allDevoteeFilter) els.allDevoteeFilter.value = savedDevotee;
  if (els.allStatus) els.allStatus.value = savedStatus;
  renderAllCoupons();

  if (tableWrap) tableWrap.scrollTop = scrollTop;

  showToast(`${toSettle.length} coupon(s) settled`);
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
  coupon._updated = ts();

  // For selects (dropdowns) — save immediately, no debounce needed
  if (field.tagName === "SELECT") {
    clearTimeout(saveTimer);
    isEditing = false;
    saveState();
    return;
  }

  // For text inputs: debounce so we don't write to Firebase on every keystroke.
  // Keep isEditing=true during this window so incoming Firebase updates don't
  // overwrite what the user is currently typing.
  isEditing = true;
  updateSyncBadge("⏳ Saving...");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    isEditing = false;
    saveState();
    applyPendingFirebaseData();
  }, 300); // 300ms is fast enough to feel instant, light enough for Firebase
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
    _updated: ts()
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
      _updated: savedCoupon._updated || ts()
    };
  });
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

  <article><span>Coupons Amount</span><strong>${formatMoney(summary.settledAmount)}</strong></article>
  <article><span>Hundi Amount</span><strong>${formatMoney(summary.hundiAmount || 0)}</strong></article>
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
  const headers = ["Coupon", "Assigned To", "Assigned Date", "Devotee Contact", "Buyer Name", "Buyer Contact", "Amount", "Settlement", "Settlement Date", "Description", "Payment Mode"];
  const rows = state.coupons.map((coupon) => {
    const devotee = state.devotees.find((item) => item.id === coupon.devoteeId);
    return [
      coupon.number,
      devotee ? devotee.name : "",
      coupon.assignedAt,
      devotee ? devotee.contact : "",
      coupon.buyerName,
      coupon.buyerContact,
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
      const content = reader.result.trim();
      const isJson = file.name.toLowerCase().endsWith(".json") || content.startsWith("{");

      if (isJson) {
        // JSON import
        const imported = JSON.parse(content);
        if (!Array.isArray(imported.devotees) || !Array.isArray(imported.coupons)) {
          throw new Error("Invalid backup");
        }

        state.settings = {
          adminPassword: imported.settings?.adminPassword || state.settings.adminPassword || DEFAULT_ADMIN_PASSWORD,
          totalCoupons: positiveInteger(imported.settings?.totalCoupons) || imported.coupons.length || DEFAULT_TOTAL_COUPONS
        };
        state.devotees = imported.devotees.map(normalizeDevotee);
        state.coupons = normalizeCoupons(imported.coupons, state.settings.totalCoupons);
        state.hundi = Array.isArray(imported.hundi)
          ? imported.hundi.map(h => ({
              id: h.id, devoteeId: h.devoteeId, amount: h.amount,
              date: h.date, settled: Boolean(h.settled), _updated: h._updated
            }))
          : [];

        saveState();
        render();
        showToast("JSON backup imported");
      } else {
        // CSV import
        const result = parseCSVImport(content);
        if (!result.success) {
          showToast(result.message);
          return;
        }

        // Merge data
        if (result.settings) {
          state.settings = { ...state.settings, ...result.settings };
        }
        if (result.devotees.length) {
          result.devotees.forEach(d => {
            const existing = state.devotees.find(e => e.id === d.id);
            if (existing) {
              Object.assign(existing, d);
            } else {
              state.devotees.push(d);
            }
          });
        }
        if (result.coupons.length) {
          result.coupons.forEach(c => {
            const idx = c.number - 1;
            if (idx >= 0 && idx < state.coupons.length) {
              state.coupons[idx] = { ...state.coupons[idx], ...c };
            }
          });
        }

        saveState();
        render();
        showToast(`CSV imported: ${result.coupons.length} coupons, ${result.devotees.length} devotees`);
      }
    } catch (err) {
      console.error("Import error:", err);
      showToast("Could not import this file. Check format.");
    } finally {
      event.target.value = "";
    }
  });
  reader.readAsText(file);
}

function parseCSVImport(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) {
    return { success: false, message: "CSV file is empty or invalid" };
  }

  // Auto-detect format based on headers
  const header = lines[0].toLowerCase();
  let devotees = [];
  let coupons = [];
  let settings = {};

  if (header.includes("coupon") && header.includes("buyer")) {
    // Coupon data format: Coupon, Buyer Name, Contact, Amount, Seva, Assigned To
    coupons = parseCouponCSV(lines);
  } else if (header.includes("name") && (header.includes("pin") || header.includes("password"))) {
    // Devotee format: Name, Contact, PIN
    devotees = parseDevoteeCSV(lines);
  } else if (header.includes("name") && header.includes("contact")) {
    // Check if it's devotees or mixed format
    if (header.includes("assigned") || header.includes("amount")) {
      // Mixed format - try both
      const couponResult = parseCouponCSV(lines);
      const devoteeResult = parseDevoteeCSV(lines);
      coupons = couponResult;
      devotees = devoteeResult;
    } else {
      devotees = parseDevoteeCSV(lines);
    }
  } else {
    // Try to parse as coupon list
    coupons = parseCouponCSV(lines);
  }

  return { success: true, devotees, coupons, settings };
}

function parseDevoteeCSV(lines) {
  const devotees = [];
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

  const nameIdx = headers.findIndex(h => h.includes("name"));
  const contactIdx = headers.findIndex(h => h.includes("contact") || h.includes("phone") || h.includes("mobile"));
  const pinIdx = headers.findIndex(h => h.includes("pin") || h.includes("password") || h.includes("pass"));

  if (nameIdx === -1) return devotees;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[nameIdx]) continue;

    devotees.push({
      id: newId(),
      name: cols[nameIdx].trim(),
      contact: contactIdx >= 0 ? cols[contactIdx].replace(/\D/g, "") : "",
      pin: pinIdx >= 0 ? cols[pinIdx].trim() : ""
    });
  }
  return devotees;
}

function parseCouponCSV(lines) {
  const coupons = [];
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

  const numIdx = headers.findIndex(h => h.includes("coupon") || h.includes("number") || h.includes("#"));
  const buyerIdx = headers.findIndex(h => h.includes("buyer") || h.includes("name"));
  const contactIdx = headers.findIndex(h => h.includes("contact") || h.includes("phone") || h.includes("mobile"));
  const amountIdx = headers.findIndex(h => h.includes("amount") || h.includes("price") || h.includes("₹"));
  const descIdx = headers.findIndex(h => h.includes("seva") || h.includes("description") || h.includes("type"));
  const settledIdx = headers.findIndex(h => h.includes("settle") || h.includes("status"));

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const num = numIdx >= 0 ? parseInt(cols[numIdx]) : i;

    if (!num || num < 1) continue;

    const amount = amountIdx >= 0 ? parseFloat(cols[amountIdx].replace(/[^0-9.]/g, "")) : 0;
    const isSettled = settledIdx >= 0 ? cols[settledIdx].toLowerCase().includes("settle") : false;

    if (buyerIdx >= 0 && cols[buyerIdx].trim()) {
      coupons.push({
        number: num,
        buyerName: cols[buyerIdx].trim(),
        buyerContact: contactIdx >= 0 ? cols[contactIdx].replace(/\D/g, "") : "",
        amount: amount || "",
        description: descIdx >= 0 ? cols[descIdx].trim() : "",
        settled: isSettled,
        settledAt: isSettled ? todayKey() : ""
      });
    }
  }
  return coupons;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
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
  if (els.invitationMessageInput && state.settings.invitationMessage) {
    els.invitationMessageInput.value = state.settings.invitationMessage;
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
  const phone = coupon.buyerContact.replace(/\D/g, "");
  const url = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
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
    _updated: devotee._updated || ts()
  };
}
// ================= FIREBASE SYNC WITH ACID PROPERTIES =================

let firebaseReady = false;
let dbRef = null;
let localVersion = 0;
let syncQueue = [];
let isSyncing = false;

// getVersionStamp() is defined at the top of the file as a monotonic counter

function ts() {
  return new Date().toISOString();
}

function updateSyncBadge(text) {
  const badge = els.syncBadge || document.getElementById("syncBadge");
  if (badge) badge.textContent = text;
}

// ATOMICITY: Queue-based updates with version tracking
function queueSyncUpdate(data) {
  syncQueue.push({
    data,
    timestamp: getVersionStamp(),
    version: ++localVersion
  });
  processSyncQueue();
}

function processSyncQueue() {
  // No longer used — saveState now pushes directly with dbRef.set()
  // Kept as stub to avoid any reference errors
}

function applyFirebaseData(data) {
  if (!data) return;
  applyFirebaseDataWithVersion(data);
}

function applyFirebaseDataWithVersion(data) {
  // ISOLATION: Don't apply if we're currently editing
  if (isEditing) {
    pendingFirebaseData = data;
    return;
  }

  const incomingVersion = data._version || 0;

  // Skip if this is our own write (same version we just pushed)
  if (incomingVersion === localVersion) {
    return;
  }

  // Skip if genuinely older than what we have locally
  if (incomingVersion < localVersion) {
    return;
  }

  // Apply data from Firebase (newer version from another device/tab)
  if (data.settings) {
    state.settings = {
      ...state.settings,
      ...data.settings
    };
  }
  if (Array.isArray(data.devotees)) {
    state.devotees = data.devotees.map(d => {
      const existing = state.devotees.find(e => e.id === d.id);
      return normalizeDevotee(existing ? { ...existing, ...d } : d);
    });
  }
  if (Array.isArray(data.coupons)) {
    state.coupons = normalizeCoupons(data.coupons, couponTotal());
  }
  if (Array.isArray(data.hundi)) {
    // Preserve settled status — do NOT default to false
    state.hundi = data.hundi.map(h => ({
      id: h.id,
      devoteeId: h.devoteeId,
      amount: h.amount,
      date: h.date,
      settled: Boolean(h.settled),
      _updated: h._updated
    }));
  }

  localVersion = incomingVersion;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  idbPut(JSON.parse(JSON.stringify(state)));
  renderSelectors();
  render();
}

function applyPendingFirebaseData() {
  if (!pendingFirebaseData) return;
  const data = pendingFirebaseData;
  pendingFirebaseData = null;
  applyFirebaseData(data);
}

function updateAdminView() {
  document.querySelectorAll("[data-admin-section]").forEach(section => {
    section.style.display =
      section.dataset.adminSection === activeAdminTab ? "" : "none";
  });
}

// Global reference to Firebase push function — set after initFirebaseSync
function _pushToFirebase() {
  // Placeholder until Firebase is initialized — overwritten below
}

function initFirebaseSync() {
  try {
    if (!window.firebase || !window.COUPON_TRACKER_FIREBASE?.config?.databaseURL) {
      idbGet().then(idbData => {
        if (idbData && Array.isArray(idbData.devotees) && Array.isArray(idbData.coupons)) {
          const totalCoupons = positiveInteger(idbData.settings?.totalCoupons) || idbData.coupons.length || DEFAULT_TOTAL_COUPONS;
          state.settings = {
            adminPassword: idbData.settings?.adminPassword || DEFAULT_ADMIN_PASSWORD,
            totalCoupons,
            invitationMessage: idbData.settings?.invitationMessage || "",
            viewerPassword: idbData.settings?.viewerPassword || ""
          };
          state.devotees = idbData.devotees.map(normalizeDevotee);
          state.coupons = normalizeCoupons(idbData.coupons, totalCoupons);
          state.hundi = Array.isArray(idbData.hundi) ? idbData.hundi.map(h => ({
            id: h.id, devoteeId: h.devoteeId, amount: h.amount,
            date: h.date, settled: Boolean(h.settled), _updated: h._updated
          })) : [];
          state._version = idbData._version || 0;
          localVersion = state._version;
          renderSelectors();
          render();
        }
      });
      updateSyncBadge("Local");
      return;
    }

    updateSyncBadge("Connecting...");

    if (!firebase.apps.length) {
      firebase.initializeApp(window.COUPON_TRACKER_FIREBASE.config);
    }

    firebase.auth().signInAnonymously()
      .then(() => {
        firebaseReady = true;

        dbRef = firebase.database().ref(
          window.COUPON_TRACKER_FIREBASE.databasePath || "couponTracker/appState"
        );

        // ✅ Read once to bootstrap local state from Firebase, THEN start real-time listener
        dbRef.once("value").then((snap) => {
          const existingData = snap.val();

          if (existingData && Array.isArray(existingData.devotees) && Array.isArray(existingData.coupons)) {
            const freshVersion = existingData._version || 0;

            // Only load Firebase data if it's genuinely newer than local
            if (freshVersion > localVersion) {
              state.settings = { ...state.settings, ...existingData.settings };
              state.devotees = existingData.devotees.map(d => {
                const existing = state.devotees.find(e => e.id === d.id);
                return normalizeDevotee(existing ? { ...existing, ...d } : d);
              });
              state.coupons = normalizeCoupons(existingData.coupons, state.settings.totalCoupons || DEFAULT_TOTAL_COUPONS);
              state.hundi = Array.isArray(existingData.hundi) ? existingData.hundi.map(h => ({
                id: h.id, devoteeId: h.devoteeId, amount: h.amount,
                date: h.date, settled: Boolean(h.settled), _updated: h._updated
              })) : [];
              localVersion = freshVersion;
              state._version = freshVersion;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
              idbPut(JSON.parse(JSON.stringify(state)));
            } else if (localVersion > freshVersion) {
              // Local data is newer — push it up to Firebase
              _doPushToFirebase();
            } else {
              // Same version — no changes needed
              localVersion = freshVersion;
            }
          } else {
            // Firebase is empty — push local state up
            _doPushToFirebase();
          }

          updateSyncBadge("Synced ✓");
          renderSelectors();
          render();

          // ✅ Start real-time listener AFTER bootstrap completes — prevents double-apply of initial data
          dbRef.on("value", (snapshot) => {
            if (!snapshot.exists()) return;
            const data = snapshot.val();
            const incomingVersion = data._version || 0;

            // Skip our own write echoes (version matches what we just set)
            if (incomingVersion === localVersion) return;

            if (isEditing) {
              pendingFirebaseData = data;
              return;
            }
            applyFirebaseData(data);
          });
        }).catch((err) => {
          console.error("Firebase Read Error:", err);
          idbGet().then(idbData => {
            if (idbData && Array.isArray(idbData.devotees) && Array.isArray(idbData.coupons)) {
              const totalCoupons = positiveInteger(idbData.settings?.totalCoupons) || idbData.coupons.length || DEFAULT_TOTAL_COUPONS;
              state.settings = {
                adminPassword: idbData.settings?.adminPassword || DEFAULT_ADMIN_PASSWORD,
                totalCoupons,
                invitationMessage: idbData.settings?.invitationMessage || "",
                viewerPassword: idbData.settings?.viewerPassword || ""
              };
              state.devotees = idbData.devotees.map(normalizeDevotee);
              state.coupons = normalizeCoupons(idbData.coupons, totalCoupons);
              state.hundi = Array.isArray(idbData.hundi) ? idbData.hundi.map(h => ({
                id: h.id, devoteeId: h.devoteeId, amount: h.amount,
                date: h.date, settled: Boolean(h.settled), _updated: h._updated
              })) : [];
              state._version = idbData._version || 0;
              localVersion = state._version;
              renderSelectors();
              render();
            }
          });
          updateSyncBadge("Local");
        });
      })
      .catch((err) => {
        console.error("Firebase Auth Error:", err);
        updateSyncBadge("Auth error");
      });

  } catch (err) {
    console.error("Firebase Init Error:", err);
    updateSyncBadge("Error");
  }
}

// ✅ Internal function that writes current state to Firebase with a single consistent version stamp
function _doPushToFirebase() {
  if (!firebaseReady || !dbRef) return;

  // Generate one version stamp used BOTH locally and in Firebase
  const version = getVersionStamp();
  state._version = version;
  state._lastSync = new Date().toISOString();
  localVersion = version;

  // Save locally first
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  idbPut(JSON.parse(JSON.stringify(state)));

  // Push to Firebase — listener will see this version === localVersion and skip it
  const snapshot = JSON.parse(JSON.stringify(state));
  dbRef.set(snapshot).then(() => {
    updateSyncBadge("Synced ✓");
  }).catch(err => {
    console.error("Firebase write error:", err);
    updateSyncBadge("Sync error");
  });
}

// ✅ Override saveState to persist locally AND push to Firebase atomically
{
  saveState = function saveState() {
    // Single monotonic version stamp used for BOTH local and Firebase
    // This ensures the listener can identify and skip our own write echoes
    const version = getVersionStamp();
    state._version = version;
    state._lastSync = new Date().toISOString();
    localVersion = version; // Listener will skip echoes where version === localVersion

    // ✅ Persist locally first (fast, synchronous-ish)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("localStorage write failed:", e);
    }
    idbPut(JSON.parse(JSON.stringify(state)));

    // ✅ Push to Firebase if connected
    if (firebaseReady && dbRef) {
      updateSyncBadge("⏳ Saving...");
      const snapshot = JSON.parse(JSON.stringify(state));
      dbRef.set(snapshot)
        .then(() => updateSyncBadge("Synced ✓"))
        .catch(err => {
          console.error("Firebase write error:", err);
          updateSyncBadge("⚠️ Retry...");
          // Retry once after 2 seconds
          setTimeout(() => {
            if (firebaseReady && dbRef) {
              dbRef.set(JSON.parse(JSON.stringify(state)))
                .then(() => updateSyncBadge("Synced ✓"))
                .catch(() => updateSyncBadge("❌ Sync failed"));
            }
          }, 2000);
        });
    }
  };
}

function openSoldEditModal(couponNumber) {
  const coupon = state.coupons[Number(couponNumber) - 1];
  if (!coupon) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Edit Coupon #${couponNumber}</h3>
      <div class="coupon-fields">
        <label>
          Buyer Name
          <input type="text" id="editBuyerName" value="${escapeAttr(coupon.buyerName || "")}" placeholder="Name">
        </label>
        <label>
          Contact Number
          <input type="tel" id="editBuyerContact" value="${escapeAttr(coupon.buyerContact || "")}" placeholder="Phone">
        </label>
        <label>
          Amount Received
          <input type="number" id="editAmount" min="0" step="1" value="${escapeAttr(coupon.amount)}" placeholder="0">
        </label>
        <label>
          Receipt Number
          <input type="text" id="editReceiptNumber" value="${escapeAttr(coupon.receiptNumber || "")}" placeholder="Receipt No">
        </label>
        <label>
          Seva Type
          <select id="editDescription">
            <option value="">Select Seva</option>
            <option value="Deepa Seva" ${coupon.description === "Deepa Seva" ? "selected" : ""}>Deepa Seva</option>
            <option value="Chenetha Seva" ${coupon.description === "Chenetha Seva" ? "selected" : ""}>Chenetha Seva</option>
            <option value="Sumangala Subhadram" ${coupon.description === "Sumangala Subhadram" ? "selected" : ""}>Sumangala Subhadram</option>
            <option value="Panchopachara Seva" ${coupon.description === "Panchopachara Seva" ? "selected" : ""}>Panchopachara Seva</option>
            <option value="General Donation" ${coupon.description === "General Donation" ? "selected" : ""}>General Donation</option>
            <option value="Prasadam Donation" ${coupon.description === "Prasadam Donation" ? "selected" : ""}>Prasadam Donation</option>
            <option value="Donation in Kind" ${coupon.description === "Donation in Kind" ? "selected" : ""}>Donation in Kind</option>
          </select>
        </label>
        <label>
          Payment Mode
          <select id="editPaymentMode">
            <option value="cash" ${(!coupon.paymentMode || coupon.paymentMode === "cash") ? "selected" : ""}>Cash</option>
            <option value="temple_transfer" ${coupon.paymentMode === "temple_transfer" ? "selected" : ""}>Temple Transfer</option>
          </select>
        </label>
      </div>
      <div class="inline-fields" style="margin-top:16px">
        <button type="button" id="saveSoldEditBtn" class="primary">Save</button>
        <button type="button" id="cancelSoldEditBtn" class="ghost">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#cancelSoldEditBtn").addEventListener("click", () => {
    overlay.remove();
  });

  overlay.querySelector("#saveSoldEditBtn").addEventListener("click", () => {
    coupon.buyerName = document.getElementById("editBuyerName").value.trim();
    coupon.buyerContact = document.getElementById("editBuyerContact").value.trim();
    coupon.amount = document.getElementById("editAmount").value;
    coupon.receiptNumber = document.getElementById("editReceiptNumber").value.trim();
    coupon.description = document.getElementById("editDescription").value;
    coupon.paymentMode = document.getElementById("editPaymentMode").value;

    saveState();
    renderEntryList();
    renderStats();
    showToast(`Coupon #${couponNumber} updated`);
    overlay.remove();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
