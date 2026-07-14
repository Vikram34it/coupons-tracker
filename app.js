const DEFAULT_TOTAL_COUPONS = 3000;
const STORAGE_KEY = "coupon-seva-tracker-v1";
const AUTH_KEY = "coupon-seva-session-v1";
const DEFAULT_ADMIN_PASSWORD = "hare krishna";
const APP_URL = "https://vikram34it.github.io/coupons-tracker/";
const SHEET_SYNC_DEBOUNCE_MS = 2000;
const SHEET_HOURLY_SYNC_MS = 60 * 60 * 1000;
const ALL_COUPONS_PAGE_SIZE = 75;
const ENTRY_PAGE_SIZE = 60;
const CHECKIN_PAGE_SIZE = 100;

const state = loadState();
let session = loadSession();
let activeDevoteeTab = "pending";
let activeAdminTab = "dashboard";
let currentEntryPage = 1;
let currentCheckinPage = 1;
let isEditing = false;
let pendingFirebaseData = null;
const pendingLocalCouponNumbers = new Set();
const dirtyCouponNumbers = new Set();
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

// Lookup caches for O(1) access
let _devMap = null;
let _couponsByDev = null;

function ensureDevMap() {
  if (!_devMap || _devMap.size !== state.devotees.length) {
    _devMap = new Map(state.devotees.map(d => [d.id, d]));
  }
  return _devMap;
}

function ensureCouponsByDev() {
  if (!_couponsByDev) {
    _couponsByDev = new Map();
    for (const c of state.coupons) {
      if (c.devoteeId) {
        let list = _couponsByDev.get(c.devoteeId);
        if (!list) { list = []; _couponsByDev.set(c.devoteeId, list); }
        list.push(c);
      }
    }
  }
  return _couponsByDev;
}

function invalidateCaches() {
  _devMap = null;
  _couponsByDev = null;
}

function getCachedDevotee(id) {
  return ensureDevMap().get(id) || null;
}

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
  renderLoginRole();
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
      whatsappTemplates: [
        { from: 1, to: 4000, template: "" },
        { from: 4001, to: totalCoupons || 6512, template: "" }
      ],
      smsTemplates: [
        { from: 1, to: 4000, template: "Hare Krishna 🙏\n\nDear {name},\n\nThank you for your seva. Your coupon number is #{coupon}. Seva: {seva}, Amount: {amount}. Devotee: {devotee}.\n\nhttps://vikram34it.github.io/coupons-tracker/" },
        { from: 4001, to: totalCoupons || 6512, template: "Hare Krishna 🙏\n\nDear {name},\n\nThank you for your seva. Your coupon number is #{coupon}. Seva: {seva}, Amount: {amount}. Devotee: {devotee}.\n\nhttps://vikram34it.github.io/coupons-tracker/" }
      ],
      viewerPassword: "",
      sheetAutoUpdate: false,
      sheetHourlyUpdate: false,
      sheetWebhookUrl: ""
    },
    devotees: [],
    coupons: makeCoupons(totalCoupons),
    hundi: []
  };
}

function normalizeSettings(settings = {}, fallbackTotal = DEFAULT_TOTAL_COUPONS) {
  const total = positiveInteger(settings.totalCoupons) || fallbackTotal || DEFAULT_TOTAL_COUPONS;
  const defaultSms = "Hare Krishna 🙏\n\nDear {name},\n\nThank you for your seva. Your coupon number is #{coupon}. Seva: {seva}, Amount: {amount}. Devotee: {devotee}.\n\nhttps://vikram34it.github.io/coupons-tracker/";

  let whatsappTemplates = settings.whatsappTemplates;
  if (!Array.isArray(whatsappTemplates) || !whatsappTemplates.length) {
    const old = settings.invitationMessage || "";
    const firstTo = Math.min(4000, total);
    whatsappTemplates = [
      { from: 1, to: firstTo, template: old }
    ];
    if (total > 4000) {
      whatsappTemplates.push({ from: 4001, to: total, template: old });
    }
  }

  let smsTemplates = settings.smsTemplates;
  if (!Array.isArray(smsTemplates) || !smsTemplates.length) {
    const old = settings.smsTemplate || defaultSms;
    const firstTo = Math.min(4000, total);
    smsTemplates = [
      { from: 1, to: firstTo, template: old }
    ];
    if (total > 4000) {
      smsTemplates.push({ from: 4001, to: total, template: old });
    }
  }

  return {
    adminPassword: settings.adminPassword || DEFAULT_ADMIN_PASSWORD,
    totalCoupons: total,
    whatsappTemplates,
    smsTemplates,
    viewerPassword: settings.viewerPassword || "",
    sheetAutoUpdate: Boolean(settings.sheetAutoUpdate),
    sheetHourlyUpdate: Boolean(settings.sheetHourlyUpdate),
    sheetWebhookUrl: settings.sheetWebhookUrl || ""
  };
}

function getTemplateForCoupon(templates, couponNumber) {
  if (!templates || !templates.length) return "";
  const match = templates.find(t => couponNumber >= t.from && couponNumber <= t.to);
  return match ? match.template : (templates[0]?.template || "");
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
  invalidateCaches();
  lastEditTime = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
    try {
      saveToIndexedDB(state);
    } catch (e2) {}
  }
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

  for (const c of state.coupons) {
    if (c.settled && inSettlementPeriod(c, period)) {
      const seva = c.description || "Others";
      if (!sevaMap[seva]) sevaMap[seva] = { count: 0, amount: 0 };
      sevaMap[seva].count += 1;
      sevaMap[seva].amount += amountValue(c.amount);
    }
  }

  for (const h of (state.hundi || [])) {
    if (h.settled) {
      const seva = "Hundi Donation";
      if (!sevaMap[seva]) sevaMap[seva] = { count: 0, amount: 0 };
      sevaMap[seva].count += 1;
      sevaMap[seva].amount += h.amount;
    }
  }
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
    "logoutBtn", "userBadge", "syncBadge", "printViewBtn", "scrollTopBtn", "csvBtn", "exportBtn", "importFile", "totalCoupons", "assignedCoupons", "soldCoupons", "couponSettledMoney", "hundiSettledMoney", "moneyReceived", "settledCoupons", "unsettledMoney", "templeTransferMoney", "cashTotalMoney",
    "devoteeForm", "devoteeName", "devoteeContact", "devoteePassword", "devoteeCanCheckin", "assignForm", "assignDevotee", "assignFrom",
    "assignTo", "assignDate", "assignSendWhatsapp", "assignHint",
    "transferForm", "transferFromDevotee", "transferToDevotee", "transferFrom", "transferTo", "transferHint",
    "couponSettingsForm", "totalCouponInput", "resetCouponForm", "resetCouponNumber", "resetDevotee", "resetCouponList",
    "selectAllResetCouponsBtn", "clearResetSelectionBtn", "resetSelectedCouponsBtn", "resetDevoteeCouponsBtn", "resetAllCouponsBtn",
    "resetFrom", "resetTo", "resetRangeBtn",
    "adminPasswordForm", "adminPassword", "viewerPasswordForm", "viewerPasswordInput", "sheetSyncForm", "sheetAutoUpdate", "sheetHourlyUpdate", "sheetWebhookUrl", "sheetSyncNowBtn", "sheetSyncStatus",
    "batchSmsBtn",
    "adminPeriodSummary", "dashboardDevoteeFilter", "devoteeList", "entryDevotee", "devoteeStats", "entrySearch",
    "entryStatus", "entryList", "allSearch", "allStatus", "allSevaFilter", "allPaymentFilter", "allDevoteeFilter", "allCouponCount", "devoteePendingDisplay", "sevaSummary", "allCouponsBody", "allPagination",
    "bulkSettleBar", "selectAllSettle", "selectedCount", "batchSettleBtn", "bulkSettleTh", "selectAllSettleHead", "toast",
    "checkinInput", "checkinBtn", "checkinUndoBtn", "checkinResult", "checkinTotalSold", "checkinCheckedIn", "checkinPending",
    "checkinDevoteeFilter", "checkinSevaFilter", "checkinStatusFilter", "checkinSearch", "checkinCount", "checkinReportBody", "checkinPagination", "checkinPrintBtn",
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
      renderView();
    });
  });

  // Auto-set assign date to today
  if (els.assignDate && !els.assignDate.value) els.assignDate.value = todayKey();

  els.loginForm.addEventListener("submit", login);
  els.loginRole.addEventListener("change", renderLoginRole);
  els.logoutBtn.addEventListener("click", logout);
  els.devoteeForm.addEventListener("submit", addDevotee);
  els.assignForm.addEventListener("submit", assignCoupons);
  els.transferForm.addEventListener("submit", transferCouponRange);
  els.couponSettingsForm.addEventListener("submit", updateTotalCoupons);
  els.resetCouponForm.addEventListener("submit", resetOneCoupon);
  els.resetDevotee.addEventListener("change", renderResetCouponList);
  els.selectAllResetCouponsBtn.addEventListener("click", selectAllResetCoupons);
  els.clearResetSelectionBtn.addEventListener("click", clearResetSelection);
  els.resetSelectedCouponsBtn.addEventListener("click", resetSelectedCoupons);
  els.resetDevoteeCouponsBtn.addEventListener("click", resetDevoteeCoupons);
  els.resetAllCouponsBtn.addEventListener("click", resetAllCoupons);
  els.resetRangeBtn.addEventListener("click", resetCouponRange);
  els.adminPasswordForm.addEventListener("submit", updateAdminPassword);
  els.viewerPasswordForm.addEventListener("submit", updateViewerPassword);
  els.sheetSyncForm.addEventListener("submit", saveSheetSyncSettings);
  els.sheetSyncNowBtn.addEventListener("click", syncSheetNow);
  if (els.invitationForm) els.invitationForm.addEventListener("submit", saveInvitationTemplate);
  if (els.previewInvitationBtn) els.previewInvitationBtn.addEventListener("click", previewInvitationMessage);
  if (els.smsTemplateForm) els.smsTemplateForm.addEventListener("submit", saveSmsTemplate);
  if (els.previewSmsBtn) els.previewSmsBtn.addEventListener("click", previewSmsMessage);
  if (els.batchSmsBtn) {
    els.batchSmsBtn.addEventListener("click", () => openBulkSmsModal());
  } else {
    const btn = document.getElementById("batchSmsBtn");
    if (btn) btn.addEventListener("click", () => openBulkSmsModal());
  }
  els.dashboardDevoteeFilter.addEventListener("change", renderDevotees);
  let entrySearchDebounce;
  els.entryDevotee.addEventListener("change", () => {
    currentEntryPage = 1;
    renderEntryList();
  });
  els.entrySearch.addEventListener("input", () => {
    clearTimeout(entrySearchDebounce);
    entrySearchDebounce = setTimeout(() => {
      currentEntryPage = 1;
      renderEntryList();
    }, 150);
  });
  els.entryStatus.addEventListener("change", () => {
    currentEntryPage = 1;
    renderEntryList();
  });
  let searchDebounce;
  els.allSearch.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      selectedCouponsForSettle.clear();
      currentPage = 1;
      renderAllCoupons();
      renderPagination();
    }, 200);
  });
  els.allStatus.addEventListener("change", resetAllCouponsView);
  els.allSevaFilter.addEventListener("change", resetAllCouponsView);
  els.allPaymentFilter.addEventListener("change", resetAllCouponsView);
  els.exportBtn.addEventListener("click", exportBackup);
  els.csvBtn.addEventListener("click", exportCsv);
  els.importFile.addEventListener("change", importBackup);
  els.printViewBtn.addEventListener("click", printCouponReport);
  els.scrollTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  if (els.batchSettleBtn) els.batchSettleBtn.addEventListener("click", batchSettle);
  if (els.selectAllSettle) els.selectAllSettle.addEventListener("change", (e) => toggleSelectAll(e.target));
  if (els.selectAllSettleHead) els.selectAllSettleHead.addEventListener("change", (e) => toggleSelectAll(e.target));
  if (els.allCouponsBody) {
    els.allCouponsBody.addEventListener("click", handleAllCouponsTableClick);
    els.allCouponsBody.addEventListener("change", handleAllCouponsTableChange);
  }
  document.querySelectorAll(".sortable").forEach(th => {
    th.addEventListener("click", () => sortTable(th.dataset.sort));
  });
  window.addEventListener("scroll", () => {
    els.scrollTopBtn.classList.toggle("visible", window.scrollY > 400);
  });
  els.allDevoteeFilter.addEventListener("change", () => {
    resetAllCouponsView();
    updateDevoteePendingDisplay();
  });

  els.checkinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCheckin();
  });
  els.checkinBtn.addEventListener("click", handleCheckin);
  els.checkinUndoBtn.addEventListener("click", handleUndoCheckin);
  els.checkinDevoteeFilter.addEventListener("change", resetCheckinReport);
  els.checkinSevaFilter.addEventListener("change", resetCheckinReport);
  els.checkinStatusFilter.addEventListener("change", resetCheckinReport);
  let checkinSearchDebounce;
  els.checkinSearch.addEventListener("input", () => {
    clearTimeout(checkinSearchDebounce);
    checkinSearchDebounce = setTimeout(resetCheckinReport, 150);
  });
  els.checkinPrintBtn.addEventListener("click", () => window.print());
  els.checkinReportBody.addEventListener("click", (e) => {
    const copyEl = e.target.closest("[data-copy]");
    if (copyEl) {
      const text = copyEl.dataset.copy;
      if (text) {
        navigator.clipboard.writeText(text).then(() => showToast("Copied: " + text)).catch(() => showToast("Could not copy to clipboard"));
      }
      return;
    }
    const whatsappButton = e.target.closest("[data-wa-coupon]");
    if (whatsappButton) {
      const coupon = state.coupons[Number(whatsappButton.dataset.waCoupon) - 1];
      openWhatsAppForBuyer(coupon);
      return;
    }
  });

  document.querySelectorAll("[data-devotee-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeDevoteeTab = tab.dataset.devoteeTab;
      currentEntryPage = 1;
      document.querySelectorAll("[data-devotee-tab]").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      renderView();
    });
  });

  document.querySelectorAll("[data-admin-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
      activeAdminTab = tab.dataset.adminTab;
      activateView("adminView");
      tab.classList.add("active");
      updateAdminView();
    });
  });

  document.querySelectorAll("[data-comm-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
      activeCommTab = tab.dataset.commTab;
      renderCommunicationView();
    });
  });

  const commSmsSaveBtn = document.getElementById("commSmsSaveBtn");
  if (commSmsSaveBtn) commSmsSaveBtn.addEventListener("click", (e) => saveSmsTemplate(e));

  const commSmsAddRange = document.getElementById("commSmsAddRange");
  if (commSmsAddRange) commSmsAddRange.addEventListener("click", () => {
    const container = document.getElementById("commSmsTemplatesBody");
    if (container) addSmsTemplateRow(container, 1, couponTotal(), "");
  });

  const commWaSaveBtn = document.getElementById("commWaSaveBtn");
  if (commWaSaveBtn) commWaSaveBtn.addEventListener("click", (e) => saveInvitationTemplate(e));

  const commWaAddRange = document.getElementById("commWaAddRange");
  if (commWaAddRange) commWaAddRange.addEventListener("click", () => {
    const container = document.getElementById("commWaTemplatesBody");
    if (container) addWhatsappTemplateRow(container, 1, couponTotal(), "");
  });

  const commSmsTabSelected = document.getElementById("commSmsTabSelected");
  const commSmsTabRange = document.getElementById("commSmsTabRange");
  if (commSmsTabSelected) commSmsTabSelected.addEventListener("click", () => {
    commSmsTargetMethod = "selected";
    commSmsTabSelected.classList.add("active");
    commSmsTabSelected.style.borderBottom = "3px solid var(--primary)";
    commSmsTabSelected.style.color = "";
    commSmsTabRange.classList.remove("active");
    commSmsTabRange.style.borderBottom = "none";
    commSmsTabRange.style.color = "var(--ink-secondary)";
    document.getElementById("commSmsRangeContainer").style.display = "none";
  });
  if (commSmsTabRange) commSmsTabRange.addEventListener("click", () => {
    commSmsTargetMethod = "range";
    commSmsTabRange.classList.add("active");
    commSmsTabRange.style.borderBottom = "3px solid var(--primary)";
    commSmsTabRange.style.color = "";
    commSmsTabSelected.classList.remove("active");
    commSmsTabSelected.style.borderBottom = "none";
    commSmsTabSelected.style.color = "var(--ink-secondary)";
    document.getElementById("commSmsRangeContainer").style.display = "flex";
  });

  const commSmsGenerateBtn = document.getElementById("commSmsGenerateBtn");
  if (commSmsGenerateBtn) commSmsGenerateBtn.addEventListener("click", generateCommBulkSmsRecipients);

  const commSmsRecipientsBody = document.getElementById("commSmsRecipientsBody");
  if (commSmsRecipientsBody) commSmsRecipientsBody.addEventListener("click", (e) => {
    const sendBtn = e.target.closest(".comm-sms-single-send");
    const copyBtn = e.target.closest(".comm-sms-single-copy");
    if (sendBtn) {
      const item = generatedCommSmsRecipients.find(r => r.coupon.number === Number(sendBtn.dataset.coupon));
      if (item && item.phone) triggerSingleSms(item.phone, item.message);
    }
    if (copyBtn) {
      const item = generatedCommSmsRecipients.find(r => r.coupon.number === Number(copyBtn.dataset.coupon));
      if (item) navigator.clipboard.writeText(item.message).then(() => showToast(`Copied message for Coupon #${item.coupon.number}`));
    }
  });

  const commSmsSelectAll = document.getElementById("commSmsSelectAll");
  if (commSmsSelectAll) commSmsSelectAll.addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.querySelectorAll(".comm-sms-recipient-check:not([disabled])").forEach(cb => cb.checked = checked);
  });

  const commSmsCopyNumbers = document.getElementById("commSmsCopyNumbers");
  if (commSmsCopyNumbers) commSmsCopyNumbers.addEventListener("click", () => {
    const phones = [];
    document.querySelectorAll(".comm-sms-recipient-check:checked").forEach(cb => {
      const item = generatedCommSmsRecipients.find(r => r.coupon.number === Number(cb.dataset.coupon));
      if (item && item.phone) phones.push(item.phone.trim());
    });
    if (phones.length === 0) { showToast("No recipients checked."); return; }
    navigator.clipboard.writeText(phones.join(",")).then(() => showToast(`Copied ${phones.length} phone numbers.`));
  });

  const commSmsSendGroup = document.getElementById("commSmsSendGroup");
  if (commSmsSendGroup) commSmsSendGroup.addEventListener("click", () => {
    const phones = [];
    document.querySelectorAll(".comm-sms-recipient-check:checked").forEach(cb => {
      const item = generatedCommSmsRecipients.find(r => r.coupon.number === Number(cb.dataset.coupon));
      if (item && item.phone) phones.push(item.phone.trim());
    });
    if (phones.length === 0) { showToast("No recipients checked."); return; }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const smsTemplates = state.settings.smsTemplates || [];
    const genericTemplate = smsTemplates[0]?.template || "Hare Krishna 🙏 Dear {name}, Your coupon is #{coupon}.";
    const genericMsg = genericTemplate.replace(/{name}/g, "Devotee").replace(/{coupon}/g, "coupons").replace(/{seva}/g, "seva").replace(/{amount}/g, "your amount").replace(/{devotee}/g, "the organizer");
    const smsUrl = `sms:${phones.join(isIOS ? ';' : ',')}?body=${encodeURIComponent(genericMsg)}`;
    window.open(smsUrl, "_self");
  });

  const commWaTabSelected = document.getElementById("commWaTabSelected");
  const commWaTabRange = document.getElementById("commWaTabRange");
  if (commWaTabSelected) commWaTabSelected.addEventListener("click", () => {
    commWaTargetMethod = "selected";
    commWaTabSelected.classList.add("active");
    commWaTabSelected.style.borderBottom = "3px solid var(--primary)";
    commWaTabSelected.style.color = "";
    commWaTabRange.classList.remove("active");
    commWaTabRange.style.borderBottom = "none";
    commWaTabRange.style.color = "var(--ink-secondary)";
    document.getElementById("commWaRangeContainer").style.display = "none";
  });
  if (commWaTabRange) commWaTabRange.addEventListener("click", () => {
    commWaTargetMethod = "range";
    commWaTabRange.classList.add("active");
    commWaTabRange.style.borderBottom = "3px solid var(--primary)";
    commWaTabRange.style.color = "";
    commWaTabSelected.classList.remove("active");
    commWaTabSelected.style.borderBottom = "none";
    commWaTabSelected.style.color = "var(--ink-secondary)";
    document.getElementById("commWaRangeContainer").style.display = "flex";
  });

  const commWaGenerateBtn = document.getElementById("commWaGenerateBtn");
  if (commWaGenerateBtn) commWaGenerateBtn.addEventListener("click", generateCommWhatsappRecipients);

  const commWaRecipientsBody = document.getElementById("commWaRecipientsBody");
  if (commWaRecipientsBody) commWaRecipientsBody.addEventListener("click", (e) => {
    const sendBtn = e.target.closest(".comm-wa-single-send");
    if (sendBtn) {
      const item = generatedCommWaRecipients.find(r => r.coupon.number === Number(sendBtn.dataset.coupon));
      if (item && item.coupon) openWhatsAppForBuyer(item.coupon);
    }
  });

  const commWaSelectAll = document.getElementById("commWaSelectAll");
  if (commWaSelectAll) commWaSelectAll.addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.querySelectorAll(".comm-wa-recipient-check:not([disabled])").forEach(cb => cb.checked = checked);
  });

  const commWaSendAll = document.getElementById("commWaSendAll");
  if (commWaSendAll) commWaSendAll.addEventListener("click", () => {
    let sentCount = 0;
    document.querySelectorAll(".comm-wa-recipient-check:checked").forEach(cb => {
      const item = generatedCommWaRecipients.find(r => r.coupon.number === Number(cb.dataset.coupon));
      if (item && item.coupon && item.coupon.buyerContact) {
        const url = buildWhatsAppUrl(item.coupon.buyerContact, buildInvitationMessage(item.coupon));
        if (url) { window.open(url, "_blank"); sentCount++; }
      }
    });
    if (sentCount > 0) showToast(`Opening WhatsApp for ${sentCount} buyer(s).`);
    else showToast("No valid recipients to send to.");
  });

}

function transferCouponRange(event) {
  event.preventDefault();
  const fromDevId = els.transferFromDevotee.value;
  const toDevId = els.transferToDevotee.value;
  const from = Number(els.transferFrom.value);
  const to = Number(els.transferTo.value);

  if (!fromDevId || !toDevId) {
    showToast("Select both source and target devotee");
    return;
  }

  if (fromDevId === toDevId) {
    showToast("Source and target devotee must be different");
    return;
  }

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > couponTotal() || from > to) {
    showToast(`Enter a valid coupon range from 1 to ${couponTotal()}`);
    return;
  }

  const toTransfer = state.coupons.filter(c =>
    c.number >= from && c.number <= to && c.devoteeId === fromDevId
  );

  if (!toTransfer.length) {
    showToast(`No coupons assigned to selected devotee in range ${from}-${to}`);
    return;
  }

  const fromName = devoteeName(fromDevId);
  const toName = devoteeName(toDevId);

  if (!window.confirm(`Transfer ${toTransfer.length} coupon(s) from ${fromName} to ${toName} (range ${from}-${to})?`)) return;

  toTransfer.forEach(c => {
    c.devoteeId = toDevId;
    markCouponUpdated(c);
  });

  els.transferForm.reset();
  els.transferHint.textContent = "";
  invalidateCaches();
  saveState();
  render();
  showToast(`Transferred ${toTransfer.length} coupon(s) from ${fromName} to ${toName}`);
}

function resetAllCouponsView() {
  selectedCouponsForSettle.clear();
  currentPage = 1;
  renderAllCoupons();
  renderPagination();
}

function resetCheckinReport() {
  currentCheckinPage = 1;
  renderCheckinReport();
}

function handleAllCouponsTableClick(event) {
  const settlementButton = event.target.closest("[data-settlement]");
  if (settlementButton) {
    toggleSettlement({ currentTarget: settlementButton });
    return;
  }

  const whatsappButton = event.target.closest("[data-wa-coupon]");
  if (whatsappButton) {
    const coupon = state.coupons[Number(whatsappButton.dataset.waCoupon) - 1];
    openWhatsAppForBuyer(coupon);
    return;
  }

  const copyEl = event.target.closest("[data-copy]");
  if (copyEl) {
    const text = copyEl.dataset.copy;
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        showToast("Copied: " + text);
      }).catch(() => {
        showToast("Could not copy to clipboard");
      });
    }
  }
}

function handleAllCouponsTableChange(event) {
  const checkbox = event.target.closest(".coupon-check");
  if (!checkbox) return;

  const num = Number(checkbox.dataset.check);
  if (checkbox.checked) selectedCouponsForSettle.add(num);
  else selectedCouponsForSettle.delete(num);
  checkbox.closest("tr")?.classList.toggle("selected-row", checkbox.checked);
  updateBulkSettleUi();
}

function activateView(viewId) {
  document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll("[data-admin-tab]").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll("[data-devotee-tab]").forEach((item) => item.classList.remove("active"));
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
  activateView("adminView");
  render();
}

function logout() {
  saveSession(null);
  render();
  showToast("Logged out");
}

function renderLoginRole() {
  if (!els.loginRole || !els.loginDevoteeLabel) return;
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
  markCouponUpdated(state.coupons[number - 1]);
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

function resetCouponRange() {
  const from = positiveInteger(els.resetFrom.value);
  const to = positiveInteger(els.resetTo.value);
  if (!from || !to || from > to || from < 1 || to > couponTotal()) {
    showToast(`Enter a valid range from 1 to ${couponTotal()}`);
    return;
  }

  const numbers = [];
  for (let i = from; i <= to; i++) {
    if (state.coupons[i - 1].devoteeId || state.coupons[i - 1].buyerName) {
      numbers.push(i);
    }
  }

  if (!numbers.length) {
    showToast(`No assigned/sold coupons in range ${from}-${to}`);
    return;
  }

  resetCouponNumbers(numbers, `Reset ${numbers.length} coupon(s) from ${from} to ${to}? This will clear their assignment and sale details.`);
  els.resetFrom.value = "";
  els.resetTo.value = "";
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
  state.coupons.forEach(c => dirtyCouponNumbers.add(c.number));
  saveState();
  render();
  showToast("All coupons reset");
}

function resetCouponNumbers(numbers, message) {
  if (!window.confirm(message)) return;
  const now = Date.now();
  numbers.forEach((number) => {
    state.coupons[number - 1] = { ...emptyCoupon(number), _updated: now };
    markCouponUpdated(state.coupons[number - 1], now);
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
  showToast(`Assigned coupons ${from} to ${to}`);

  if (sendWhatsApp) {
    openWhatsAppForDevoteeAssignment(devotee, from, to, assignedAt);
  }
}

function activeView() {
  return document.querySelector(".view.active")?.id || "";
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

  const view = activeView();

  if (view === "adminView") {
    renderDevotees();
    renderSevaSummary();
    if (activeAdminTab === "reset") renderResetCouponList();
  }

  if (view === "devoteeView") {
    renderEntryList();
  }
  if (view === "allCouponsView") {
    renderAllCoupons();
    renderPagination();
  }
  if (view === "checkinView") {
    renderCheckinView();
  }
  if (view === "communicationView") {
    renderCommunicationView();
  }
  updateAdminView();

  const topStats = document.querySelector(".stats-grid");

  if (topStats) {
    if (session?.role === "devotee") {
      topStats.style.display = "none";
    } else {
      topStats.style.display = "grid";
    }
  }
}

function renderView() {
  const view = activeView();
  applyRoleAccess();
  renderStats();

  if (view === "adminView") {
    renderDevotees();
    renderSevaSummary();
  } else if (view === "devoteeView") {
    renderEntryList();
  } else if (view === "allCouponsView") {
    renderAllCoupons();
    renderPagination();
  } else if (view === "checkinView") {
    renderCheckinView();
  } else if (view === "communicationView") {
    renderCommunicationView();
  }

  updateAdminView();
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

  // ✅ TRANSFER FROM DROPDOWN
  const currentTransferFromValue = els.transferFromDevotee.value;
  els.transferFromDevotee.innerHTML = empty + options;
  if (state.devotees.some(d => d.id === currentTransferFromValue)) {
    els.transferFromDevotee.value = currentTransferFromValue;
  }

  // ✅ TRANSFER TO DROPDOWN
  const currentTransferToValue = els.transferToDevotee.value;
  els.transferToDevotee.innerHTML = empty + options;
  if (state.devotees.some(d => d.id === currentTransferToValue)) {
    els.transferToDevotee.value = currentTransferToValue;
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
  if (els.printViewBtn) els.printViewBtn.classList.toggle("hidden", !isAdmin);
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

  // Communication tab — visible to all logged-in users
  document.querySelector('[data-view="communicationView"]')?.classList.toggle("hidden", !session);

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

  // Devotee: land on devotee entry view (but allow switching to check-in and communication)
  if (isDevotee) {
    const activeViewId = document.querySelector(".view.active")?.id;
    if (activeViewId !== "checkinView" && activeViewId !== "communicationView") {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelector('[data-view="devoteeView"]')?.classList.add("active");
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      document.getElementById("devoteeView")?.classList.add("active");
    }
  }
}

function renderStats() {
  let a = 0, s = 0, st = 0, sm = 0, um = 0, tt = 0, ct = 0;
  for (const c of state.coupons) {
    const hasDev = !!c.devoteeId;
    const isSld = isSold(c);
    const isSt = c.settled;
    const amt = amountValue(c.amount);

    if (hasDev) a++;
    if (isSld) s++;
    if (isSt) { st++; sm += amt; }
    if (isSld && !isSt) um += amt;
    if (c.paymentMode === "temple_transfer") tt += amt;
    if (isSt && c.paymentMode === "cash") ct += amt;
  }

  const hundiMoney = (state.hundi || []).filter(h => h.settled).reduce((sum, h) => sum + h.amount, 0);

  els.totalCoupons.textContent = couponTotal().toLocaleString("en-IN");
  els.assignedCoupons.textContent = a.toLocaleString("en-IN");
  els.soldCoupons.textContent = s.toLocaleString("en-IN");
  if (els.couponSettledMoney) els.couponSettledMoney.textContent = formatMoney(sm);
  if (els.hundiSettledMoney) els.hundiSettledMoney.textContent = formatMoney(hundiMoney);
  els.moneyReceived.textContent = formatMoney(sm + hundiMoney);
  els.settledCoupons.textContent = st.toLocaleString("en-IN");
  if (els.unsettledMoney) els.unsettledMoney.textContent = formatMoney(um);
  if (els.templeTransferMoney) els.templeTransferMoney.textContent = formatMoney(tt);
  if (els.cashTotalMoney) els.cashTotalMoney.textContent = formatMoney(ct);
}

function renderDevotees() {
  if (session?.role === "devotee") {
    if (els.devoteeList) els.devoteeList.innerHTML = "";
    return;
  }

  const period = settlementPeriod();
  const selectedDevotee = els.dashboardDevoteeFilter?.value || "all";

  let devotees = state.devotees.filter((devotee) => {
    if (selectedDevotee !== "all" && devotee.id !== selectedDevotee) return false;
    return true;
  });

  devotees.sort((a, b) => a.name.localeCompare(b.name));

  const hundiPeriod = (state.hundi || [])
    .filter(h => h.settled && inSettlementPeriod({ settledAt: h.date }, period))
    .reduce((sum, h) => sum + h.amount, 0);

  const periodTotal = state.coupons
    .filter((coupon) => coupon.settled && inSettlementPeriod(coupon, period))
    .reduce((sum, coupon) => sum + amountValue(coupon.amount), 0) + hundiPeriod;

  els.adminPeriodSummary.textContent = `Money settled ${period.label}: ${formatMoney(periodTotal)}`;

  if (!devotees.length) {
    els.devoteeList.innerHTML = `<div class="empty">No devotees found.</div>`;
    return;
  }

  els.devoteeList.innerHTML = devotees.map((devotee) => {
    const summary = devoteeSummary(devotee.id, period);
    const assigned = couponsForDevotee(devotee.id);
    const ranges = summarizeCouponRanges(assigned.map((coupon) => coupon.number));

    return `
      <article class="devotee-row" data-devotee-id="${escapeAttr(devotee.id)}">
        <div>
          <strong>
            ${escapeHtml(devotee.name)}
            <span class="pin-mask" data-pin="${escapeAttr(devotee.pin || '')}">
              ${devotee.pin ? '••••' : 'No PIN'}
            </span>
          </strong>
          <span class="small-stat">${escapeHtml(devotee.contact || "No contact number")}</span>
          <div>${ranges.map((range) => `<span class="coupon-pill">${range}</span>`).join("") || '<span class="small-stat">No coupons assigned</span>'}</div>
        </div>
        <span><strong>${summary.issued}</strong> <span class="small-stat">issued</span></span>
        <span><strong>${summary.sold}</strong> <span class="small-stat">sold</span></span>
        <span><strong>${summary.left}</strong> <span class="small-stat">left</span></span>
        <span><strong>${formatMoney(summary.settledAmount)}</strong> <span class="small-stat">coupons</span></span>
        <span><strong>${formatMoney(summary.hundiAmount || 0)}</strong> <span class="small-stat">hundi</span></span>
        <span><strong>${formatMoney(summary.totalSettledAmount)}</strong> <span class="small-stat">total</span></span>
        <span><strong>${formatMoney(summary.templeTransferAmount || 0)}</strong> <span class="small-stat">transfer</span></span>
        <span><strong>${formatMoney(summary.pendingAmount)}</strong> <span class="small-stat">pending</span></span>
        ${session?.role === "viewer" ? "" : `
        <label class="checkbox-line can-checkin-toggle">
          <input type="checkbox" data-action="can-checkin" value="${escapeAttr(devotee.id)}" ${devotee.canCheckin ? "checked" : ""}> Check-in
        </label>
        <button class="ghost" type="button" data-action="edit-name" value="${escapeAttr(devotee.id)}" title="Edit devotee name">Rename</button>
        <button class="ghost" type="button" data-action="set-password" value="${escapeAttr(devotee.id)}">Password</button>
        <button class="ghost" type="button" data-action="send-whatsapp" value="${escapeAttr(devotee.id)}">WhatsApp</button>
        <button class="ghost" type="button" data-action="update-contact" value="${escapeAttr(devotee.id)}">Contact</button>
        <button class="danger" type="button" data-action="delete-devotee" value="${escapeAttr(devotee.id)}">Delete</button>
        <button class="ghost" type="button" data-action="open-devotee" value="${escapeAttr(devotee.id)}">Open</button>
        `}
      </article>`;
  }).join("");

  // Single event delegation listener
  if (!els.devoteeList.dataset.hasListener) {
    els.devoteeList.dataset.hasListener = "1";
    els.devoteeList.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        handleDevoteeAction(actionBtn.dataset.action, actionBtn.value, actionBtn);
        return;
      }
      const pinMask = e.target.closest(".pin-mask");
      if (pinMask) {
        const revealed = pinMask.dataset.revealed === "1";
        pinMask.dataset.revealed = revealed ? "0" : "1";
        pinMask.textContent = revealed
          ? (pinMask.dataset.pin ? '••••' : 'No PIN')
          : (pinMask.dataset.pin || 'Not set');
        pinMask.title = revealed ? 'Click to reveal PIN' : 'Click to hide PIN';
      }
    });
    els.devoteeList.addEventListener("change", (e) => {
      const checkinCb = e.target.closest("[data-action='can-checkin']");
      if (checkinCb) {
        const devotee = state.devotees.find((d) => d.id === checkinCb.value);
        if (!devotee) return;
        devotee.canCheckin = checkinCb.checked;
        saveState();
        showToast(`${devotee.name} check-in ${checkinCb.checked ? "enabled" : "disabled"}`);
      }
    });
  }
}

function handleDevoteeAction(action, value, btn) {
  const devotee = state.devotees.find((d) => d.id === value);
  if (!devotee) return;

  if (action === "open-devotee") {
    els.entryDevotee.value = value;
    document.querySelector('[data-view="devoteeView"]').click();
    return;
  }

  if (action === "delete-devotee") {
    deleteDevotee(value);
    return;
  }

  if (action === "edit-name") {
    const newName = window.prompt(`Enter new name for ${devotee.name}`, devotee.name);
    if (newName === null || !newName.trim()) {
      if (newName !== null) showToast("Name cannot be empty");
      return;
    }
    devotee.name = newName.trim();
    saveState();
    renderDevotees();
    renderSelectors();
    showToast(`Devotee renamed to ${devotee.name}`);
    return;
  }

  if (action === "set-password") {
    const password = window.prompt(`Enter new password for ${devotee.name}`);
    if (password === null || password.trim().length < 4) {
      if (password !== null) showToast("Use at least 4 characters");
      return;
    }
    devotee.pin = password.trim();
    saveState();
    renderDevotees();
    renderSelectors();
    showToast(`Password updated for ${devotee.name}`);
    return;
  }

  if (action === "update-contact") {
    const newContact = window.prompt(`Enter new contact for ${devotee.name}`, devotee.contact || "");
    if (newContact === null) return;
    const cleaned = cleanIndianMobile(newContact);
    if (!cleaned) { showToast("Enter valid 10-digit mobile number"); return; }
    devotee.contact = cleaned;
    saveState();
    render();
    showToast(`Contact updated for ${devotee.name}`);
    return;
  }

  if (action === "send-whatsapp") {
    const period = settlementPeriod();
    const summary = devoteeSummary(devotee.id, period);
    const assigned = couponsForDevotee(devotee.id).length;
    const message = `Hare Krishna 🙏\n\n${devotee.name},\n\nHere is your seva summary:\n\n🔐 PIN: ${devotee.pin || "Not set"}\n\n🎟 Coupons Assigned: ${assigned}\n🟢 Sold Coupons: ${summary.sold}\n🟡 Pending Coupons: ${summary.left}\n\n💰 Amount Settled: ${formatMoney(summary.settledAmount)}\n⌛ Amount Pending: ${formatMoney(summary.pendingAmount)}\n\nPlease continue your seva enthusiastically 🙏\n\nUse the following link to update your coupons:\nhttps://vikram34it.github.io/coupons-tracker/`;
    const phone = (devotee.contact || "").replace(/\D/g, "");
    if (!phone) { showToast("No contact number for this devotee"); return; }
    const url = buildWhatsAppUrl(phone, message);
    if (!url) { showToast("Enter valid contact number for this devotee"); return; }
    window.open(url, "_blank");
  }
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

    // (handled by event delegation below)

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
    const hasTemplate = (state.settings.whatsappTemplates || []).some(t => t.template);
    const noTemplateBanner = !hasTemplate
      ? `<div class="notice-banner">
           ⚠️ No WhatsApp template set. <strong>Admin: go to Communication → WhatsApp</strong> to create one.
         </div>`
      : "";

    const settledWithContact = coupons.filter(c => c.buyerContact);
    els.entryList.innerHTML = `
    ${noTemplateBanner}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coupon</th>
            <th>Buyer</th>
            <th>Contact</th>
            <th>Call</th>
            <th>Send Invite</th>
            <th>Amount</th>
            <th>Seva</th>
            <th>Payment Mode</th>
            <th>Sold Date</th>
          </tr>
        </thead>
        <tbody>
          ${coupons.map(coupon => `
            <tr>
              <td>#${coupon.number}</td>
              <td>${escapeHtml(coupon.buyerName || "-")}</td>
              <td>${coupon.buyerContact ? `<span class="copy-contact" data-copy="${escapeAttr(coupon.buyerContact)}" title="Click to copy">${escapeHtml(coupon.buyerContact)}</span>` : '-'}</td>
              <td>${coupon.buyerContact ? `<a href="tel:${escapeAttr(coupon.buyerContact)}" class="call-btn" title="Call ${escapeAttr(coupon.buyerContact)}">📞</a>` : '-'}</td>
              <td>
                ${coupon.buyerContact
        ? `<button class="wa-btn" type="button" data-wa-coupon="${coupon.number}" title="Send WhatsApp invitation to buyer">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                      Send
                    </button>`
        : `<span class="small-stat">No contact</span>`
      }
              </td>
              <td>${formatMoney(coupon.amount)}</td>
              <td>${escapeHtml(coupon.description || "-")}</td>
              <td>${coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"}</td>
              <td>${escapeHtml(coupon.soldAt || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

    // (handled by event delegation below)
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

  const totalPages = Math.max(1, Math.ceil(coupons.length / ENTRY_PAGE_SIZE));
  currentEntryPage = Math.max(1, Math.min(currentEntryPage, totalPages));
  const pageStart = (currentEntryPage - 1) * ENTRY_PAGE_SIZE;
  const visibleCoupons = coupons.slice(pageStart, pageStart + ENTRY_PAGE_SIZE);

  els.entryList.innerHTML = visibleCoupons.map((coupon) => {
    const locked = session?.role === "viewer" || (session?.role === "devotee" && coupon.settled) ? "disabled" : "";
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
  }).join("") + buildPaginationHtml(
    coupons.length,
    currentEntryPage,
    ENTRY_PAGE_SIZE,
    "goToEntryPage"
  );

  setupEntryListDelegation();
}

function setupEntryListDelegation() {
  if (els.entryList.dataset.hasEntryListener) return;
  els.entryList.dataset.hasEntryListener = "1";

  els.entryList.addEventListener("click", (e) => {
    const target = e.target;

    if (target.id === "addHundiBtn") {
      const devoteeId = els.entryDevotee.value;
      if (!devoteeId) { showToast("Select a devotee first"); return; }
      const amount = Number(document.getElementById("hundiAmount")?.value);
      const date = document.getElementById("hundiDate")?.value || todayKey();
      if (!amount) { showToast("Enter amount"); return; }
      state.hundi.push({ id: newId(), devoteeId, amount, date, settled: false, _updated: Date.now() });
      saveState();
      renderEntryList();
      renderStats();
      renderDevoteeStats(devoteeId);
      renderSevaSummary();
      showToast("Hundi added");
      return;
    }

    const settleBtn = target.closest("[data-hundi-settle]");
    if (settleBtn) {
      if (session?.role !== "admin") { showToast("Only admin can settle hundi"); return; }
      const hundi = state.hundi.find(h => h.id === settleBtn.dataset.hundiSettle);
      if (!hundi) return;
      hundi.settled = !hundi.settled;
      hundi._updated = Date.now();
      saveState();
      renderEntryList();
      renderStats();
      renderDevoteeStats(hundi.devoteeId);
      renderSevaSummary();
      showToast(hundi.settled ? "Hundi settled" : "Hundi marked pending");
      return;
    }

    const editBtn = target.closest("[data-hundi-edit]");
    if (editBtn) {
      if (session?.role !== "admin") { showToast("Only admin can edit hundi"); return; }
      const hundi = state.hundi.find(h => h.id === editBtn.dataset.hundiEdit);
      if (!hundi) return;
      const date = window.prompt("Enter hundi date (YYYY-MM-DD)", hundi.date || todayKey());
      if (date === null) return;
      const amountInput = window.prompt("Enter hundi amount", String(hundi.amount || ""));
      if (amountInput === null) return;
      const amount = Number(amountInput);
      if (!date.trim() || !amount || amount < 0) { showToast("Enter a valid date and amount"); return; }
      hundi.date = date.trim();
      hundi.amount = amount;
      hundi._updated = Date.now();
      saveState();
      renderEntryList();
      renderStats();
      renderDevoteeStats(hundi.devoteeId);
      renderSevaSummary();
      showToast("Hundi entry updated");
      return;
    }

    const deleteBtn = target.closest("[data-hundi-delete]");
    if (deleteBtn) {
      if (session?.role !== "admin") { showToast("Only admin can delete hundi"); return; }
      const hundi = state.hundi.find(h => h.id === deleteBtn.dataset.hundiDelete);
      if (!hundi) return;
      if (!window.confirm(`Delete hundi entry ${hundi.date} for ${formatMoney(hundi.amount)}?`)) return;
      state.hundi = state.hundi.filter(h => h.id !== hundi.id);
      saveState();
      renderEntryList();
      renderStats();
      renderDevoteeStats(hundi.devoteeId);
      renderSevaSummary();
      showToast("Hundi entry deleted");
      return;
    }

    const waBtn = target.closest("[data-wa-coupon]");
    if (waBtn) {
      const coupon = state.coupons[Number(waBtn.dataset.waCoupon) - 1];
      openWhatsAppForBuyer(coupon);
      return;
    }
  });

  els.entryList.addEventListener("input", (e) => {
    const field = e.target.closest("[data-field]");
    if (!field || field.tagName === "SELECT") return;
    updateCouponField(e);
  });

  els.entryList.addEventListener("change", (e) => {
    const field = e.target.closest("[data-field]");
    if (!field || field.tagName !== "SELECT") return;
    updateCouponField(e);
  });

  els.entryList.addEventListener("focusout", (e) => {
    const field = e.target.closest("[data-field='buyerContact']");
    if (!field) return;
    const val = field.value.replace(/\D/g, "");
    if (val && val.length !== 10) {
      showToast("Contact number should be 10 digits");
    }
  });
}

function renderAllCoupons() {
  const query = els.allSearch.value.trim().toLowerCase();
  const status = els.allStatus.value;
  const sevaFilter = els.allSevaFilter?.value || "all";
  const paymentFilter = els.allPaymentFilter?.value || "all";
  const isAdmin = session?.role === "admin";
  const isViewer = session?.role === "viewer";
  const canSelect = isAdmin || isViewer;

  if (els.bulkSettleBar) els.bulkSettleBar.style.display = canSelect ? "flex" : "none";
  if (els.bulkSettleTh) els.bulkSettleTh.style.display = canSelect ? "" : "none";
  if (els.batchSettleBtn) els.batchSettleBtn.style.display = isAdmin ? "" : "none";
  const smsBtn = els.batchSmsBtn || document.getElementById("batchSmsBtn");
  if (smsBtn) smsBtn.style.display = canSelect ? "" : "none";
  const filterBarSmsBtn = document.getElementById("filterBarSmsBtn");
  if (filterBarSmsBtn) filterBarSmsBtn.style.display = canSelect ? "" : "none";

  updateBulkSettleUi();

  const devoteeFilter = els.allDevoteeFilter?.value;
  const hasDevFilter = devoteeFilter && devoteeFilter !== "all";
  const hasStatus = status !== "all";
  const hasSeva = sevaFilter !== "all";
  const hasPayment = paymentFilter !== "all";
  const hasQuery = !!query;

  let coupons = state.coupons;
  if (hasStatus || hasDevFilter || hasSeva || hasPayment || hasQuery) {
    coupons = state.coupons.filter(c => {
      if (hasStatus) {
        if (status === "unassigned" && c.devoteeId) return false;
        if (status === "assigned" && !c.devoteeId) return false;
        if (status === "sold" && !isSold(c)) return false;
        if (status === "settled" && !c.settled) return false;
        if (status === "unsettled" && (!c.devoteeId || !isSold(c) || c.settled)) return false;
        if (status === "sold_unsettled" && (!c.devoteeId || !isSold(c) || c.settled || amountValue(c.amount) <= 0)) return false;
      }
      if (hasDevFilter && c.devoteeId !== devoteeFilter) return false;
      if (hasSeva && (c.description || "") !== sevaFilter) return false;
      if (hasPayment && (c.paymentMode || "cash") !== paymentFilter) return false;
      if (hasQuery && !couponSearchText(c).includes(query)) return false;
      return true;
    });
  }

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

  if (els.allCouponCount) {
    const label = coupons.length === 1 ? "Coupon" : "Coupons";
    els.allCouponCount.textContent = `${label}: ${coupons.length.toLocaleString("en-IN")}`;
  }

  const totalPages = Math.max(1, Math.ceil(couponDataCache.length / ALL_COUPONS_PAGE_SIZE));
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStart = (currentPage - 1) * ALL_COUPONS_PAGE_SIZE;
  const visibleCoupons = couponDataCache.slice(pageStart, pageStart + ALL_COUPONS_PAGE_SIZE);

  if (!visibleCoupons.length) {
    els.allCouponsBody.innerHTML = `<tr><td colspan="${(isAdmin || isViewer) ? 14 : 13}"><div class="empty">No coupons match the filters.</div></td></tr>`;
    return;
  }

  els.allCouponsBody.innerHTML = visibleCoupons.map((coupon) => {
    const checked = selectedCouponsForSettle.has(coupon.number);
    return `
    <tr class="${checked ? 'selected-row' : ''}">
      ${(isAdmin || isViewer) ? `<td><input type="checkbox" class="coupon-check" data-check="${coupon.number}" ${checked ? 'checked' : ''}></td>` : ''}
      <td>#${coupon.number}</td>
      <td>${escapeHtml(devoteeName(coupon.devoteeId) || "-")}</td>
      <td>${escapeHtml(coupon.buyerName || "-")}</td>
      <td>${coupon.buyerContact ? `<span class="copy-contact" data-copy="${escapeAttr(coupon.buyerContact)}" title="Click to copy">${escapeHtml(coupon.buyerContact)}</span>` : '-'}</td>
      <td>${coupon.buyerContact ? `<a href="tel:${escapeAttr(coupon.buyerContact)}" class="call-btn" title="Call ${escapeAttr(coupon.buyerContact)}">📞</a>` : '-'}</td>
      <td>
        ${(!isViewer && coupon.settled && coupon.buyerContact)
        ? `<button class="wa-btn" type="button" data-wa-coupon="${coupon.number}" title="Send WhatsApp invitation to buyer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
              Send
            </button>`
        : `<span class="small-stat">\u2013</span>`
      }
      </td>
      <td>${coupon.amount ? escapeHtml(formatMoney(amountValue(coupon.amount))) : "-"}</td>
      <td>${coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"}</td>
      <td>
        ${isViewer
        ? `<span class="status ${coupon.settled ? 'settled' : 'pending'}">${coupon.settled ? "\u2713 Settled" : "Pending"}</span>`
        : `<button class="ghost settlement-btn${coupon.settled ? ' is-settled' : ''}" type="button" data-settlement="${coupon.number}">
              ${coupon.settled ? "\u2713 Settled" : "Mark Settled"}
            </button>`
      }
      </td>
      <td>${escapeHtml(coupon.description || "-")}</td>
      <td>${escapeHtml(coupon.assignedAt || "-")}</td>
      <td>${escapeHtml(coupon.soldAt || "-")}</td>
      <td>${escapeHtml(coupon.settledAt || "-")}</td>
    </tr>
  `;
  }).join("");

}

let currentSortColumn = null;

let currentSortOrder = "asc";

let couponDataCache = [];

let currentPage = 1;

const selectedCouponsForSettle = new Set();

function updateBulkSettleUi() {
  const count = selectedCouponsForSettle.size;
  const el = document.getElementById("selectedCount");
  if (el) el.textContent = `${count} selected`;
  const btn = document.getElementById("batchSettleBtn");
  if (btn) btn.disabled = count === 0;
}

function toggleSelectAll(source) {
  const checked = source.checked;
  document.querySelectorAll(".coupon-check").forEach(cb => {
    cb.checked = checked;
    const num = Number(cb.dataset.check);
    if (checked) selectedCouponsForSettle.add(num);
    else selectedCouponsForSettle.delete(num);
    cb.closest("tr")?.classList.toggle("selected-row", checked);
  });
  const head = document.getElementById("selectAllSettleHead");
  if (head && head !== source) head.checked = checked;
  const bar = document.getElementById("selectAllSettle");
  if (bar && bar !== source) bar.checked = checked;
  updateBulkSettleUi();
}

function batchSettle() {
  if (session?.role !== "admin") {
    showToast("Only admin can settle coupons");
    return;
  }
  const unsettled = [...selectedCouponsForSettle]
    .map(num => state.coupons[num - 1])
    .filter(c => c && !c.settled);
  if (!unsettled.length) {
    showToast("None of the selected coupons are pending settlement");
    return;
  }
  const amt = unsettled.reduce((s, c) => s + amountValue(c.amount), 0);
  const confirmed = window.confirm(
    `Mark ${unsettled.length} coupon${unsettled.length > 1 ? 's' : ''} as settled${amt > 0 ? ` for ${formatMoney(amt)}` : ''}?`
  );
  if (!confirmed) return;

  const today = todayKey();
  for (const c of unsettled) {
    c.settled = true;
    c.settledAt = today;
    markCouponUpdated(c);
  }
  saveState();

  const tableWrap = els.allCouponsBody?.closest(".table-wrap");
  const scrollTop = tableWrap ? tableWrap.scrollTop : 0;

  renderStats();
  const adminActive = document.getElementById("adminView")?.classList.contains("active");
  if (adminActive) {
    renderDevotees();
    renderSevaSummary();
  }
  updateDevoteePendingDisplay();
  renderAllCoupons();
  renderPagination();

  if (tableWrap) tableWrap.scrollTop = scrollTop;

  showToast(`Settled ${unsettled.length} coupons`);
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
  const adminActive = document.getElementById("adminView")?.classList.contains("active");
  if (adminActive) {
    renderDevotees();
    renderSevaSummary();
  }
  updateDevoteePendingDisplay();

  // ✅ Restore filters then render table once
  if (els.allDevoteeFilter && savedDevoteeFilter) els.allDevoteeFilter.value = savedDevoteeFilter;
  if (els.allStatus && savedStatus) els.allStatus.value = savedStatus;
  if (els.allSevaFilter && savedSevaFilter) els.allSevaFilter.value = savedSevaFilter;
  if (els.allPaymentFilter && savedPaymentFilter) els.allPaymentFilter.value = savedPaymentFilter;
  renderAllCoupons();
  renderPagination();

  if (tableWrap) tableWrap.scrollTop = scrollTop;

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
    coupon.soldAt = todayKey();
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
  const map = ensureCouponsByDev();
  return map.get(devoteeId) || [];
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
  if (coupon) {
    coupon._updated = updatedAt;
    dirtyCouponNumbers.add(coupon.number);
  }
}

function hasCouponData(coupon) {
  return Boolean(
    coupon.devoteeId ||
    coupon.assignedAt ||
    coupon.buyerName ||
    coupon.buyerContact ||
    coupon.amount ||
    coupon.description ||
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
  <article class="stat-card stat-overview">
    <div class="stat-icon">📋</div>
    <div class="stat-body">
      <span class="stat-label">Coupons Issued</span>
      <strong class="stat-value">${summary.issued}</strong>
    </div>
  </article>
  <article class="stat-card stat-overview">
    <div class="stat-icon">✅</div>
    <div class="stat-body">
      <span class="stat-label">Coupons Sold</span>
      <strong class="stat-value">${summary.sold}</strong>
    </div>
  </article>
  <article class="stat-card stat-overview">
    <div class="stat-icon">⏳</div>
    <div class="stat-body">
      <span class="stat-label">Coupons Left</span>
      <strong class="stat-value">${summary.left}</strong>
    </div>
  </article>
  <article class="stat-card stat-settlement">
    <div class="stat-icon">💰</div>
    <div class="stat-body">
      <span class="stat-label">Coupons Settled</span>
      <strong class="stat-value">${formatMoney(summary.settledAmount)}</strong>
    </div>
  </article>
  <article class="stat-card stat-settlement">
    <div class="stat-icon">🪙</div>
    <div class="stat-body">
      <span class="stat-label">Hundi Settled</span>
      <strong class="stat-value">${formatMoney(summary.hundiAmount || 0)}</strong>
    </div>
  </article>
  <article class="stat-card stat-total">
    <div class="stat-icon">💵</div>
    <div class="stat-body">
      <span class="stat-label">Total Settled</span>
      <strong class="stat-value">${formatMoney(summary.totalSettledAmount)}</strong>
    </div>
  </article>
  <article class="stat-card stat-pending">
    <div class="stat-icon">⏳</div>
    <div class="stat-body">
      <span class="stat-label">Pending Coupons</span>
      <strong class="stat-value">${formatMoney(summary.pendingAmount)}</strong>
    </div>
  </article>
  <article class="stat-card stat-pending">
    <div class="stat-icon">📊</div>
    <div class="stat-body">
      <span class="stat-label">Total Pending</span>
      <strong class="stat-value">${formatMoney(summary.totalPendingAmount)}</strong>
    </div>
  </article>
  <article class="stat-card stat-count">
    <div class="stat-icon">🏆</div>
    <div class="stat-body">
      <span class="stat-label">Settled Coupons</span>
      <strong class="stat-value">${summary.settledCount}</strong>
    </div>
  </article>
  <article class="stat-card stat-mode">
    <div class="stat-icon">🏛️</div>
    <div class="stat-body">
      <span class="stat-label">Temple Transfer</span>
      <strong class="stat-value">${formatMoney(summary.templeTransferAmount || 0)}</strong>
    </div>
  </article>
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
  const devotee = getCachedDevotee(devoteeId);
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
  const dMap = ensureDevMap();
  const rows = state.coupons.map((coupon) => {
    const devotee = dMap.get(coupon.devoteeId);
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
  if (!state.settings.whatsappTemplates) state.settings.whatsappTemplates = [];
  const forms = document.querySelectorAll(".comm-wa-template-row");
  state.settings.whatsappTemplates = [];
  forms.forEach(row => {
    const from = Number(row.querySelector(".comm-template-from")?.value) || 1;
    const to = Number(row.querySelector(".comm-template-to")?.value) || couponTotal();
    const template = row.querySelector(".comm-template-body")?.value.trim() || "";
    state.settings.whatsappTemplates.push({ from, to, template });
  });
  state.settings.whatsappTemplates.sort((a, b) => a.from - b.from);
  saveState();

  const badge = document.getElementById("commWaSavedBadge");
  if (badge) {
    badge.classList.remove("hidden");
    clearTimeout(saveInvitationTemplate._timer);
    saveInvitationTemplate._timer = setTimeout(() => badge.classList.add("hidden"), 2500);
  }
  showToast("WhatsApp templates saved ✓");
}

function loadInvitationTemplate() {
  const container = document.getElementById("commWaTemplatesBody");
  if (!container) return;
  const templates = state.settings.whatsappTemplates || [];
  container.innerHTML = "";
  if (templates.length === 0) {
    addWhatsappTemplateRow(container, 1, couponTotal(), "");
    return;
  }
  templates.forEach(t => addWhatsappTemplateRow(container, t.from, t.to, t.template));
}

function buildInvitationMessage(coupon) {
  const devotee = state.devotees.find(d => d.id === coupon.devoteeId);
  const template = getTemplateForCoupon(state.settings.whatsappTemplates, coupon.number);
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
  if (!(state.settings.whatsappTemplates || []).some(t => t.template)) {
    showToast("No WhatsApp template set — Admin: go to Communication → WhatsApp");
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
        <p class="hint mb-sm">Sample preview using placeholder values.</p>
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

// ═══════════════════════════════════════════════
// 💬  SMS INVITATION FEATURE & BULK SENDER
// ═══════════════════════════════════════════════

let smsTargetMethod = "selected";
let generatedSmsRecipients = [];

function saveSmsTemplate(event) {
  event.preventDefault();
  if (!state.settings.smsTemplates) state.settings.smsTemplates = [];
  const forms = document.querySelectorAll(".comm-sms-template-row");
  state.settings.smsTemplates = [];
  forms.forEach(row => {
    const from = Number(row.querySelector(".comm-template-from")?.value) || 1;
    const to = Number(row.querySelector(".comm-template-to")?.value) || couponTotal();
    const template = row.querySelector(".comm-template-body")?.value.trim() || "";
    state.settings.smsTemplates.push({ from, to, template });
  });
  state.settings.smsTemplates.sort((a, b) => a.from - b.from);
  saveState();

  const badge = document.getElementById("commSmsSavedBadge");
  if (badge) {
    badge.classList.remove("hidden");
    clearTimeout(saveSmsTemplate._timer);
    saveSmsTemplate._timer = setTimeout(() => badge.classList.add("hidden"), 2500);
  }
  showToast("SMS templates saved ✓");
}

function loadSmsTemplate() {
  const container = document.getElementById("commSmsTemplatesBody");
  if (!container) return;
  const templates = state.settings.smsTemplates || [];
  container.innerHTML = "";
  if (templates.length === 0) {
    addSmsTemplateRow(container, 1, couponTotal(), "");
    return;
  }
  templates.forEach(t => addSmsTemplateRow(container, t.from, t.to, t.template));
}

function previewSmsMessage() {
  const template = els.smsTemplateInput?.value.trim();
  if (!template) {
    showToast("Write an SMS message template first");
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
  let overlay = document.getElementById("smsPreviewOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "smsPreviewOverlay";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="SMS Message preview">
        <h3>💬 SMS Message Preview</h3>
        <p class="hint mb-sm">Sample preview using placeholder values.</p>
        <div class="message-preview" id="smsPreviewText" style="white-space: pre-wrap; font-family: monospace; background: var(--bg); padding: 12px; border-radius: var(--radius); border: 1px solid var(--line); margin-bottom: 12px;"></div>
        <div class="inline-fields">
          <button type="button" id="smsPreviewClose">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close on button click
    overlay.querySelector("#smsPreviewClose").addEventListener("click", () => {
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

  document.getElementById("smsPreviewText").textContent = sample;
  overlay.classList.remove("hidden");
}

function openBulkSmsModal(startWithRange) {
  try {
    const count = selectedCouponsForSettle.size;

    // Create/reuse modal
    let overlay = document.getElementById("bulkSmsOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "bulkSmsOverlay";
      overlay.className = "modal-overlay hidden";
      overlay.innerHTML = `
        <div class="modal-card" style="max-width: 800px; width: 95%;">
          <h3 style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span>💬 Send SMS to Devotees/Buyers</span>
          </h3>
          <p class="hint mb-md">Compose your message and select recipient contacts using checkboxes or a coupon range.</p>

          <div class="sms-tabs" style="display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 2px solid var(--line); padding-bottom: 8px;">
            <button type="button" id="smsTabSelected" class="tab-btn active" style="flex: 1; padding: 8px; border: none; background: none; border-bottom: 3px solid var(--primary); font-weight: 600; cursor: pointer;">Selected Coupons (<span id="smsSelectedCount">0</span>)</button>
            <button type="button" id="smsTabRange" class="tab-btn" style="flex: 1; padding: 8px; border: none; background: none; font-weight: 600; cursor: pointer; color: var(--ink-secondary);">Coupon Range</button>
          </div>

          <div id="smsRangeContainer" style="display: none; gap: 15px; margin-bottom: 15px; background: rgba(0,0,0,0.02); padding: 12px; border-radius: var(--radius); border: 1px solid var(--line);">
            <div style="flex: 1;">
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">From Coupon #</label>
              <input type="number" id="smsRangeFrom" min="1" placeholder="1" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius);">
            </div>
            <div style="flex: 1;">
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">To Coupon #</label>
              <input type="number" id="smsRangeTo" min="1" placeholder="100" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius);">
            </div>
          </div>

          <div style="margin-bottom: 15px;">
            <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px;">SMS Message Template</label>
            <textarea id="smsModalTemplate" rows="4" style="width: 100%; padding: 10px; font-family: inherit; border: 1px solid var(--line); border-radius: var(--radius); resize: vertical;" placeholder="Enter message body... Use placeholders: {name}, {coupon}, {seva}, {amount}, {devotee}"></textarea>
            <p class="hint" style="margin-top: 4px; font-size: 11px;">Placeholders: <strong>{name}</strong>, <strong>{coupon}</strong>, <strong>{seva}</strong>, <strong>{amount}</strong>, <strong>{devotee}</strong></p>
          </div>

          <div style="display: flex; gap: 10px; margin-bottom: 15px;">
            <button type="button" id="smsGenerateBtn" class="primary" style="flex: 1;">🔍 Generate Recipients & Messages</button>
          </div>

          <div id="smsRecipientsSection" style="display: none; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; margin-bottom: 15px;">
            <div class="table-wrap" style="max-height: 250px; overflow-y: auto; margin-bottom: 0;">
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 0;">
                <thead style="position: sticky; top: 0; background: var(--surface); box-shadow: 0 1px 0 var(--line); z-index: 10;">
                  <tr>
                    <th style="width: 40px; text-align: center;"><input type="checkbox" id="smsSelectAllRecipients" checked></th>
                    <th style="width: 80px;">Coupon</th>
                    <th>Name & Phone</th>
                    <th>Message Preview</th>
                    <th style="width: 120px; text-align: center;">Actions</th>
                  </tr>
                </thead>
                <tbody id="smsRecipientsBody">
                </tbody>
              </table>
            </div>
            <div style="background: rgba(0,0,0,0.01); padding: 8px 12px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--ink-secondary);">
              <span id="smsRecipientsCount">0 recipients ready</span>
              <span id="smsPhoneWarning" style="color: var(--danger); font-weight: 600; display: none;">⚠️ Some selected coupons have no phone number</span>
            </div>
          </div>

          <div class="inline-fields" style="justify-content: flex-end; gap: 8px;">
            <button type="button" id="smsCopyAllNumbers" class="secondary init-hidden" style="background: var(--bg-hover);">📋 Copy Numbers</button>
            <button type="button" id="smsSendGroup" class="primary init-hidden" style="background: var(--primary); border-color: var(--primary);">📲 Send Group SMS</button>
            <button type="button" id="smsModalClose" class="ghost">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const selectAllCheck = overlay.querySelector("#smsSelectAllRecipients");
      selectAllCheck.addEventListener("change", (e) => {
        const checked = e.target.checked;
        overlay.querySelectorAll(".sms-recipient-check:not([disabled])").forEach(cb => {
          cb.checked = checked;
        });
      });

      const tabSelected = overlay.querySelector("#smsTabSelected");
      const tabRange = overlay.querySelector("#smsTabRange");
      const rangeContainer = overlay.querySelector("#smsRangeContainer");

      function activateSmsTab(method) {
        smsTargetMethod = method;
        if (method === "selected") {
          tabSelected.classList.add("active");
          tabSelected.style.borderBottom = "3px solid var(--primary)";
          tabSelected.style.color = "";
          tabRange.classList.remove("active");
          tabRange.style.borderBottom = "none";
          tabRange.style.color = "var(--ink-secondary)";
          rangeContainer.style.display = "none";
        } else {
          tabRange.classList.add("active");
          tabRange.style.borderBottom = "3px solid var(--primary)";
          tabRange.style.color = "";
          tabSelected.classList.remove("active");
          tabSelected.style.borderBottom = "none";
          tabSelected.style.color = "var(--ink-secondary)";
          rangeContainer.style.display = "flex";
        }
      }

      tabSelected.addEventListener("click", () => activateSmsTab("selected"));
      tabRange.addEventListener("click", () => activateSmsTab("range"));

      overlay.querySelector("#smsGenerateBtn").addEventListener("click", generateBulkSmsRecipients);

      overlay.querySelector("#smsRecipientsBody").addEventListener("click", (e) => {
        const sendBtn = e.target.closest(".sms-single-send-btn");
        const copyBtn = e.target.closest(".sms-single-copy-btn");

        if (sendBtn) {
          const couponNum = Number(sendBtn.dataset.coupon);
          const item = generatedSmsRecipients.find(r => r.coupon.number === couponNum);
          if (item && item.phone) {
            triggerSingleSms(item.phone, item.message);
          }
        }
        if (copyBtn) {
          const couponNum = Number(copyBtn.dataset.coupon);
          const item = generatedSmsRecipients.find(r => r.coupon.number === couponNum);
          if (item) {
            navigator.clipboard.writeText(item.message).then(() => {
              showToast(`Copied message for Coupon #${couponNum}`);
            });
          }
        }
      });

      overlay.querySelector("#smsCopyAllNumbers").addEventListener("click", () => {
        const phones = getCheckedPhones();
        if (phones.length === 0) {
          showToast("No recipients checked.");
          return;
        }
        navigator.clipboard.writeText(phones.join(",")).then(() => {
          showToast(`Copied ${phones.length} phone numbers to clipboard.`);
        });
      });

      overlay.querySelector("#smsSendGroup").addEventListener("click", () => {
        const phones = getCheckedPhones();
        if (phones.length === 0) {
          showToast("No recipients checked.");
          return;
        }

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const separator = isIOS ? ';' : ',';

        const smsTemplates = state.settings.smsTemplates || [];
        const genericTemplate = (smsTemplates[0]?.template || "Hare Krishna 🙏 Dear {name}, Your coupon is #{coupon}.")
        const genericMsg = genericTemplate
          .replace(/{name}/g, "Devotee")
          .replace(/{coupon}/g, "coupons")
          .replace(/{seva}/g, "seva")
          .replace(/{amount}/g, "your amount")
          .replace(/{devotee}/g, "the organizer");

        const smsUrl = `sms:${phones.join(separator)}?body=${encodeURIComponent(genericMsg)}`;
        window.open(smsUrl, "_self");
      });

      overlay.querySelector("#smsModalClose").addEventListener("click", () => {
        overlay.classList.add("hidden");
      });

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.add("hidden");
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
          overlay.classList.add("hidden");
        }
      });

      overlay._activateSmsTab = activateSmsTab;
    }

    document.getElementById("smsSelectedCount").textContent = count;
    document.getElementById("smsModalTemplate").value = "Templates are now configured per coupon range in Communication → SMS. Each coupon will use its matching template.";
    document.getElementById("smsModalTemplate").disabled = true;
    document.getElementById("smsRangeFrom").value = "1";
    document.getElementById("smsRangeTo").value = String(state.coupons.length || 100);

    if (startWithRange === true || count === 0) {
      overlay._activateSmsTab("range");
    } else {
      overlay._activateSmsTab("selected");
    }

    document.getElementById("smsRecipientsSection").style.display = "none";
    document.getElementById("smsCopyAllNumbers").classList.add("init-hidden");
    document.getElementById("smsSendGroup").classList.add("init-hidden");

    overlay.classList.remove("hidden");
  } catch (err) {
    console.error("openBulkSmsModal error:", err);
    showToast("Failed to open SMS modal: " + err.message);
  }
}

function generateBulkSmsRecipients() {
  const method = smsTargetMethod;

  let targetCoupons = [];
  if (method === "selected") {
    const nums = Array.from(selectedCouponsForSettle).sort((a, b) => a - b);
    targetCoupons = nums.map(n => state.coupons[n - 1]).filter(Boolean);
    if (targetCoupons.length === 0) {
      showToast("No coupons selected in the table. Use checkboxes or select the Range tab.");
      return;
    }
  } else {
    const fromVal = Number(document.getElementById("smsRangeFrom").value);
    const toVal = Number(document.getElementById("smsRangeTo").value);
    if (!fromVal || !toVal || fromVal < 1 || toVal < 1 || fromVal > toVal) {
      showToast("Please enter a valid coupon range (From <= To)");
      return;
    }
    const maxCoupons = state.coupons.length;
    if (fromVal > maxCoupons) {
      showToast(`From value cannot be greater than total coupons (${maxCoupons})`);
      return;
    }
    const actualTo = Math.min(toVal, maxCoupons);
    targetCoupons = state.coupons.slice(fromVal - 1, actualTo);
  }

  const tbody = document.getElementById("smsRecipientsBody");
  tbody.innerHTML = "";

  let withPhoneCount = 0;
  let hasMissingPhone = false;
  generatedSmsRecipients = [];

  targetCoupons.forEach(coupon => {
    const phone = coupon.buyerContact ? String(coupon.buyerContact).trim() : "";
    const hasPhone = phone.length >= 4;

    const devotee = state.devotees.find(d => d.id === coupon.devoteeId);
    const template = getTemplateForCoupon(state.settings.smsTemplates, coupon.number);
    const msgText = template
      .replace(/{name}/g, coupon.buyerName || "Devotee")
      .replace(/{coupon}/g, String(coupon.number))
      .replace(/{seva}/g, coupon.description || "Seva")
      .replace(/{amount}/g, formatMoney(amountValue(coupon.amount)))
      .replace(/{devotee}/g, devotee ? devotee.name : "");

    if (hasPhone) {
      withPhoneCount++;
    } else {
      hasMissingPhone = true;
    }

    generatedSmsRecipients.push({
      coupon,
      phone,
      hasPhone,
      message: msgText
    });

    const row = document.createElement("tr");
    if (!hasPhone) row.style.opacity = "0.6";

    row.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" class="sms-recipient-check" data-coupon="${coupon.number}" ${hasPhone ? 'checked' : 'disabled'}>
      </td>
      <td>#${coupon.number}</td>
      <td>
        <strong style="display:block; font-size:13px;">${escapeHtml(coupon.buyerName || "-")}</strong>
        <span style="font-size:12px; color: var(--ink-secondary);">${escapeHtml(phone || "No phone number")}</span>
      </td>
      <td>
        <textarea readonly style="width: 100%; font-size: 11px; padding: 4px; border: 1px solid var(--line); border-radius: 4px; resize: none; background: var(--bg); height: 45px; font-family: monospace;">${escapeHtml(msgText)}</textarea>
      </td>
      <td style="text-align: center;">
        <div style="display: flex; gap: 4px; justify-content: center;">
          <button type="button" class="sms-single-send-btn wa-btn" data-coupon="${coupon.number}" ${hasPhone ? '' : 'disabled'} style="padding: 4px 8px; font-size: 11px; background: var(--primary); border-color: var(--primary);">Send</button>
          <button type="button" class="sms-single-copy-btn wa-btn ghost" data-coupon="${coupon.number}" style="padding: 4px 8px; font-size: 11px; border: 1px solid var(--line);">Copy</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });

  document.getElementById("smsRecipientsSection").style.display = "block";
  document.getElementById("smsRecipientsCount").textContent = `${withPhoneCount} recipient(s) with phone numbers`;
  document.getElementById("smsPhoneWarning").style.display = hasMissingPhone ? "inline" : "none";

  // Force selectAll check to match the generated state
  const selectAllRecipients = document.getElementById("smsSelectAllRecipients");
  if (selectAllRecipients) selectAllRecipients.checked = true;

  if (withPhoneCount > 0) {
    document.getElementById("smsCopyAllNumbers").classList.remove("init-hidden");
    document.getElementById("smsSendGroup").classList.remove("init-hidden");
  } else {
    document.getElementById("smsCopyAllNumbers").classList.add("init-hidden");
    document.getElementById("smsSendGroup").classList.add("init-hidden");
  }
}

function getCheckedPhones() {
  const overlay = document.getElementById("bulkSmsOverlay");
  if (!overlay) return [];
  const checkedCheckboxes = overlay.querySelectorAll(".sms-recipient-check:checked");
  const phones = [];
  checkedCheckboxes.forEach(cb => {
    const couponNum = Number(cb.dataset.coupon);
    const item = generatedSmsRecipients.find(r => r.coupon.number === couponNum);
    if (item && item.phone) {
      phones.push(item.phone.trim());
    }
  });
  return phones;
}

function triggerSingleSms(phone, message) {
  const cleanPhone = String(phone).replace(/\D/g, "");
  const smsUrl = `sms:${cleanPhone}?body=${encodeURIComponent(message)}`;
  window.open(smsUrl, "_self");
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

function buildFirebaseUpdates() {
  const updates = {
    settings: state.settings,
    devotees: state.devotees,
    hundi: state.hundi
  };
  if (dirtyCouponNumbers.size > 0) {
    dirtyCouponNumbers.forEach(num => {
      updates[`coupons/${num - 1}`] = state.coupons[num - 1];
    });
    dirtyCouponNumbers.clear();
  }
  // When no coupons changed, omit the coupons path entirely.
  // Firebase update() only touches paths present in the object,
  // so existing coupon data on the server stays intact.
  return updates;
}

function flushPendingFirebaseWrite() {
  if (!pendingFirebaseWrite || !firebaseCanWrite || !firebaseReady || !dbRef) return;
  pendingFirebaseWrite = false;
  dbRef.update(buildFirebaseUpdates());
}

function applyFirebaseData(data, options = {}) {
  // Stale cache guard: state.coupons is about to be replaced
  invalidateCaches();
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
  const dMap = ensureDevMap();
  return state.coupons.map((coupon) => {
    const devotee = dMap.get(coupon.devoteeId);
    return {
      coupon: coupon.number,
      assignedTo: devotee ? devotee.name : "",
      assignedDate: coupon.assignedAt || "",
      devoteeContact: devotee ? devotee.contact : "",
      buyerName: coupon.buyerName || "",
      buyerContact: coupon.buyerContact || "",
      soldDate: coupon.soldAt || "",
      amount: amountValue(coupon.amount),
      paymentMode: coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash",
      settlement: coupon.settled ? "Settled" : "Not Settled",
      settledDate: coupon.settledAt || "",
      description: coupon.description || ""
    };
  });
}

function spreadsheetHundiRows() {
  const dMap = ensureDevMap();
  return (state.hundi || []).map((entry) => {
    const devotee = dMap.get(entry.devoteeId);
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
      dbRef.update(buildFirebaseUpdates());
    } else {
      pendingFirebaseWrite = true;
      updateSyncBadge("Sync pending");
    }
  }
};

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
          <div class="slip-note">Devotee: ${escapeHtml(devoteeName(coupon.devoteeId))}</div>
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
  els.allPagination.innerHTML = buildPaginationHtml(
    couponDataCache.length,
    currentPage,
    ALL_COUPONS_PAGE_SIZE,
    "goToPage"
  );
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(couponDataCache.length / ALL_COUPONS_PAGE_SIZE));
  currentPage = Math.max(1, Math.min(page, totalPages));
  renderAllCoupons();
  renderPagination();
  els.allCouponsBody.closest(".table-wrap")?.scrollTo({ top: 0, behavior: "smooth" });
}

function goToEntryPage(page) {
  currentEntryPage = Math.max(1, Number(page) || 1);
  renderEntryList();
  els.entryList?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildPaginationHtml(totalItems, current, pageSize, callbackName) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return "";

  const pages = new Set([1, totalPages, current - 1, current, current + 1]);
  const sortedPages = [...pages]
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);

  let lastPage = 0;
  const pageButtons = sortedPages.map((page) => {
    const gap = page - lastPage > 1 ? `<span class="page-gap">...</span>` : "";
    lastPage = page;
    return `${gap}<button type="button" class="${page === current ? "active-page" : ""}" onclick="${callbackName}(${page})">${page}</button>`;
  }).join("");

  const firstItem = (current - 1) * pageSize + 1;
  const lastItem = Math.min(totalItems, current * pageSize);

  return `
    <button type="button" onclick="${callbackName}(${current - 1})" ${current === 1 ? "disabled" : ""}>Prev</button>
    ${pageButtons}
    <button type="button" onclick="${callbackName}(${current + 1})" ${current === totalPages ? "disabled" : ""}>Next</button>
    <span class="page-info">${firstItem.toLocaleString("en-IN")}-${lastItem.toLocaleString("en-IN")} of ${totalItems.toLocaleString("en-IN")}</span>
  `;
}

// ═══════════════════════════════════════════════
// ✅ EVENT CHECK-IN SYSTEM
// ═══════════════════════════════════════════════

let lastCheckinNumber = null;

function canCurrentUserCheckin() {
  if (session?.role === "admin") return true;
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
  populateCheckinFilters();
  renderCheckinReport();
  els.checkinInput.value = "";
  if (canCheckin) els.checkinInput.focus();
  els.checkinResult.className = "checkin-result";
  els.checkinResult.textContent = "";
  els.checkinUndoBtn.style.display = "none";
  lastCheckinNumber = null;
}

function populateCheckinFilters() {
  const currentDevotee = els.checkinDevoteeFilter.value || "all";
  const currentSeva = els.checkinSevaFilter.value || "all";
  const sorted = [...state.devotees].sort((a, b) => a.name.localeCompare(b.name));
  els.checkinDevoteeFilter.innerHTML = '<option value="all">All Devotees</option>' +
    sorted.map(d => `<option value="${escapeAttr(d.id)}">${escapeHtml(d.name)}</option>`).join("");

  els.checkinSevaFilter.innerHTML = '<option value="all">All Seva Types</option>' +
    SEVA_TYPES.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");

  els.checkinDevoteeFilter.value = currentDevotee;
  if (els.checkinDevoteeFilter.value !== currentDevotee) els.checkinDevoteeFilter.value = "all";
  els.checkinSevaFilter.value = currentSeva;
  if (els.checkinSevaFilter.value !== currentSeva) els.checkinSevaFilter.value = "all";
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

  const searchQuery = els.checkinSearch?.value.trim().toLowerCase();
  if (searchQuery) {
    coupons = coupons.filter(c =>
      String(c.number).includes(searchQuery) ||
      (c.buyerName || "").toLowerCase().includes(searchQuery) ||
      (c.buyerContact || "").includes(searchQuery)
    );
  }

  els.checkinCount.textContent = "Coupons: " + coupons.length.toLocaleString("en-IN");

  const canCheckin = canCurrentUserCheckin();
  const totalPages = Math.max(1, Math.ceil(coupons.length / CHECKIN_PAGE_SIZE));
  currentCheckinPage = Math.max(1, Math.min(currentCheckinPage, totalPages));
  const pageStart = (currentCheckinPage - 1) * CHECKIN_PAGE_SIZE;
  const visibleCoupons = coupons.slice(pageStart, pageStart + CHECKIN_PAGE_SIZE);

  els.checkinReportBody.innerHTML = visibleCoupons.map(c => {
    const attended = c.attended;
    return `
      <tr>
        <td>#${c.number}</td>
        <td>${escapeHtml(c.buyerName || "-")}</td>
        <td><span class="copy-contact" data-copy="${escapeHtml(c.buyerContact || "-")}">${escapeHtml(c.buyerContact || "-")}</span></td>
        <td>${escapeHtml(devoteeName(c.devoteeId))}</td>
        <td>${escapeHtml(c.description || "-")}</td>
        <td><span class="attended-badge ${attended ? '' : 'missed'}">${attended ? "✓ Checked In" : "○ Not Yet"}</span></td>
        <td>${attended ? escapeHtml(c.attendedAt) : "-"}</td>
        <td class="no-print">${c.buyerContact ? `<a href="tel:${escapeAttr(c.buyerContact)}" class="call-btn" title="Call ${escapeAttr(c.buyerContact)}">📞</a>` : '-'}</td>
        ${canCheckin ? `
        <td class="no-print">
          ${attended
            ? `<button class="ghost" type="button" onclick="undoCheckinFromReport(${c.number})">Undo</button>`
            : `<button class="ghost" type="button" onclick="checkinFromReport(${c.number})">Check In</button>`
          }
        </td>` : ""}
      </tr>
    `;
  }).join("") || '<tr><td colspan="9"><div class="empty">No coupons match the filters.</div></td></tr>';

  if (els.checkinPagination) {
    els.checkinPagination.innerHTML = buildPaginationHtml(
      coupons.length,
      currentCheckinPage,
      CHECKIN_PAGE_SIZE,
      "goToCheckinPage"
    );
  }
}

function checkinFromReport(num) {
  els.checkinInput.value = num;
  handleCheckin();
}

function undoCheckinFromReport(num) {
  lastCheckinNumber = num;
  handleUndoCheckin();
}

function goToCheckinPage(page) {
  currentCheckinPage = Math.max(1, Number(page) || 1);
  renderCheckinReport();
  els.checkinReportBody?.closest(".table-wrap")?.scrollTo({ top: 0, behavior: "smooth" });
}

// ═══════════════════════════════════════════════
// 💬 COMMUNICATION TAB
// ═══════════════════════════════════════════════

let activeCommTab = "sms";
let commSmsTargetMethod = "selected";
let commWaTargetMethod = "selected";
let generatedCommSmsRecipients = [];
let generatedCommWaRecipients = [];

function renderCommunicationView() {
  const isAdmin = session?.role === "admin";

  document.querySelectorAll("[data-comm-tab]").forEach(tab => {
    if (tab.dataset.commTab === "settings") tab.classList.toggle("hidden", !isAdmin);
    tab.classList.toggle("active", tab.dataset.commTab === activeCommTab);
  });
  document.querySelectorAll("[data-comm-section]").forEach(section => {
    section.style.display = section.dataset.commSection === activeCommTab ? "" : "none";
  });

  // Hide template panels for non-admins
  if (!isAdmin) {
    document.querySelectorAll("[data-comm-section] > section.panel").forEach(panel => {
      const heading = panel.querySelector("h2")?.textContent || "";
      if (heading.includes("Template")) panel.classList.add("hidden");
    });
  }
  if (activeCommTab === "sms") {
    loadSmsTemplate();
    document.getElementById("commSmsSelectedCount").textContent = selectedCouponsForSettle.size;
    document.getElementById("commSmsRangeFrom").value = "1";
    document.getElementById("commSmsRangeTo").value = String(state.coupons.length || 100);
    document.getElementById("commSmsRecipientsSection").style.display = "none";
  } else if (activeCommTab === "whatsapp") {
    loadInvitationTemplate();
    document.getElementById("commWaSelectedCount").textContent = selectedCouponsForSettle.size;
    document.getElementById("commWaRangeFrom").value = "1";
    document.getElementById("commWaRangeTo").value = String(state.coupons.length || 100);
    document.getElementById("commWaRecipientsSection").style.display = "none";
  }
}

function addSmsTemplateRow(container, from, to, template) {
  const row = document.createElement("div");
  row.className = "comm-sms-template-row";
  row.style.cssText = "display: flex; gap: 10px; margin-bottom: 12px; align-items: flex-start; flex-wrap: wrap;";
  row.innerHTML = `
    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
      <label style="font-size: 11px; font-weight: 600; color: var(--ink-secondary);">Coupons</label>
      <input type="number" class="comm-template-from" value="${from}" min="1" style="width: 70px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 13px;">
      <span style="color: var(--ink-secondary);">to</span>
      <input type="number" class="comm-template-to" value="${to}" min="1" style="width: 70px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 13px;">
    </div>
    <div style="flex: 1; min-width: 250px;">
      <textarea class="comm-template-body" rows="4" style="width: 100%; padding: 8px; font-family: inherit; border: 1px solid var(--line); border-radius: var(--radius); resize: vertical; font-size: 13px;" placeholder="Enter SMS message... Use {name}, {coupon}, {seva}, {amount}, {devotee}">${escapeHtml(template)}</textarea>
    </div>
    <button type="button" class="ghost danger comm-remove-range" style="flex-shrink: 0; padding: 6px 10px; font-size: 13px; align-self: center;">✕</button>
  `;
  row.querySelector(".comm-remove-range").addEventListener("click", () => {
    if (container.children.length > 1) row.remove();
    else showToast("At least one template range is required.");
  });
  container.appendChild(row);
}

function addWhatsappTemplateRow(container, from, to, template) {
  const row = document.createElement("div");
  row.className = "comm-wa-template-row";
  row.style.cssText = "display: flex; gap: 10px; margin-bottom: 12px; align-items: flex-start; flex-wrap: wrap;";
  row.innerHTML = `
    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
      <label style="font-size: 11px; font-weight: 600; color: var(--ink-secondary);">Coupons</label>
      <input type="number" class="comm-template-from" value="${from}" min="1" style="width: 70px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 13px;">
      <span style="color: var(--ink-secondary);">to</span>
      <input type="number" class="comm-template-to" value="${to}" min="1" style="width: 70px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 13px;">
    </div>
    <div style="flex: 1; min-width: 250px;">
      <textarea class="comm-template-body" rows="4" style="width: 100%; padding: 8px; font-family: inherit; border: 1px solid var(--line); border-radius: var(--radius); resize: vertical; font-size: 13px;" placeholder="Enter WhatsApp message... Use {name}, {coupon}, {seva}, {amount}, {devotee}">${escapeHtml(template)}</textarea>
    </div>
    <button type="button" class="ghost danger comm-remove-range" style="flex-shrink: 0; padding: 6px 10px; font-size: 13px; align-self: center;">✕</button>
  `;
  row.querySelector(".comm-remove-range").addEventListener("click", () => {
    if (container.children.length > 1) row.remove();
    else showToast("At least one template range is required.");
  });
  container.appendChild(row);
}

function generateCommBulkSmsRecipients() {
  const method = commSmsTargetMethod;
  let targetCoupons = [];
  if (method === "selected") {
    const nums = Array.from(selectedCouponsForSettle).sort((a, b) => a - b);
    targetCoupons = nums.map(n => state.coupons[n - 1]).filter(Boolean);
    if (targetCoupons.length === 0) {
      showToast("No coupons selected. Use checkboxes in All Coupons or switch to Range tab.");
      return;
    }
  } else {
    const fromVal = Number(document.getElementById("commSmsRangeFrom").value);
    const toVal = Number(document.getElementById("commSmsRangeTo").value);
    if (!fromVal || !toVal || fromVal < 1 || toVal < 1 || fromVal > toVal) {
      showToast("Please enter a valid coupon range (From <= To)");
      return;
    }
    const maxCoupons = state.coupons.length;
    if (fromVal > maxCoupons) {
      showToast(`From value cannot be greater than total coupons (${maxCoupons})`);
      return;
    }
    const actualTo = Math.min(toVal, maxCoupons);
    targetCoupons = state.coupons.slice(fromVal - 1, actualTo);
  }

  const tbody = document.getElementById("commSmsRecipientsBody");
  tbody.innerHTML = "";
  let withPhoneCount = 0;
  let hasMissingPhone = false;
  generatedCommSmsRecipients = [];

  targetCoupons.forEach(coupon => {
    const phone = coupon.buyerContact ? String(coupon.buyerContact).trim() : "";
    const hasPhone = phone.length >= 4;
    const devotee = state.devotees.find(d => d.id === coupon.devoteeId);
    const template = getTemplateForCoupon(state.settings.smsTemplates, coupon.number);
    const msgText = template
      .replace(/{name}/g, coupon.buyerName || "Devotee")
      .replace(/{coupon}/g, String(coupon.number))
      .replace(/{seva}/g, coupon.description || "Seva")
      .replace(/{amount}/g, formatMoney(amountValue(coupon.amount)))
      .replace(/{devotee}/g, devotee ? devotee.name : "");

    if (hasPhone) withPhoneCount++;
    else hasMissingPhone = true;

    generatedCommSmsRecipients.push({ coupon, phone, hasPhone, message: msgText });

    const row = document.createElement("tr");
    if (!hasPhone) row.style.opacity = "0.6";
    row.innerHTML = `
      <td style="text-align: center;"><input type="checkbox" class="comm-sms-recipient-check" data-coupon="${coupon.number}" ${hasPhone ? 'checked' : 'disabled'}></td>
      <td>#${coupon.number}</td>
      <td><strong style="display:block; font-size:13px;">${escapeHtml(coupon.buyerName || "-")}</strong><span style="font-size:12px; color: var(--ink-secondary);">${escapeHtml(phone || "No phone number")}</span></td>
      <td><textarea readonly style="width: 100%; font-size: 11px; padding: 4px; border: 1px solid var(--line); border-radius: 4px; resize: none; background: var(--bg); height: 45px; font-family: monospace;">${escapeHtml(msgText)}</textarea></td>
      <td style="text-align: center;"><div style="display: flex; gap: 4px; justify-content: center;"><button type="button" class="comm-sms-single-send sms-btn" data-coupon="${coupon.number}" ${hasPhone ? '' : 'disabled'} style="padding: 4px 8px; font-size: 11px;">Send</button><button type="button" class="comm-sms-single-copy ghost" data-coupon="${coupon.number}" style="padding: 4px 8px; font-size: 11px;">Copy</button></div></td>
    `;
    tbody.appendChild(row);
  });

  document.getElementById("commSmsRecipientsSection").style.display = "block";
  document.getElementById("commSmsRecipientsCount").textContent = `${withPhoneCount} recipient(s) with phone numbers`;
  document.getElementById("commSmsPhoneWarning").style.display = hasMissingPhone ? "inline" : "none";
  document.getElementById("commSmsSelectAll").checked = true;
  document.getElementById("commSmsCopyNumbers").classList.toggle("init-hidden", withPhoneCount === 0);
  document.getElementById("commSmsSendGroup").classList.toggle("init-hidden", withPhoneCount === 0);
}

function generateCommWhatsappRecipients() {
  const method = commWaTargetMethod;
  let targetCoupons = [];
  if (method === "selected") {
    const nums = Array.from(selectedCouponsForSettle).sort((a, b) => a - b);
    targetCoupons = nums.map(n => state.coupons[n - 1]).filter(Boolean);
    if (targetCoupons.length === 0) {
      showToast("No coupons selected. Use checkboxes in All Coupons or switch to Range tab.");
      return;
    }
  } else {
    const fromVal = Number(document.getElementById("commWaRangeFrom").value);
    const toVal = Number(document.getElementById("commWaRangeTo").value);
    if (!fromVal || !toVal || fromVal < 1 || toVal < 1 || fromVal > toVal) {
      showToast("Please enter a valid coupon range (From <= To)");
      return;
    }
    const maxCoupons = state.coupons.length;
    if (fromVal > maxCoupons) {
      showToast(`From value cannot be greater than total coupons (${maxCoupons})`);
      return;
    }
    const actualTo = Math.min(toVal, maxCoupons);
    targetCoupons = state.coupons.slice(fromVal - 1, actualTo);
  }

  const tbody = document.getElementById("commWaRecipientsBody");
  tbody.innerHTML = "";
  let withPhoneCount = 0;
  let hasMissingPhone = false;
  generatedCommWaRecipients = [];

  targetCoupons.forEach(coupon => {
    const phone = coupon.buyerContact ? String(coupon.buyerContact).trim() : "";
    const hasPhone = phone.length >= 4;
    const devotee = state.devotees.find(d => d.id === coupon.devoteeId);
    const template = getTemplateForCoupon(state.settings.whatsappTemplates, coupon.number);
    const msgText = template
      .replace(/{name}/g, coupon.buyerName || "Devotee")
      .replace(/{coupon}/g, String(coupon.number))
      .replace(/{seva}/g, coupon.description || "Seva")
      .replace(/{amount}/g, formatMoney(amountValue(coupon.amount)))
      .replace(/{devotee}/g, devotee ? devotee.name : "");

    if (hasPhone) withPhoneCount++;
    else hasMissingPhone = true;

    generatedCommWaRecipients.push({ coupon, phone, hasPhone, message: msgText });

    const row = document.createElement("tr");
    if (!hasPhone) row.style.opacity = "0.6";
    row.innerHTML = `
      <td style="text-align: center;"><input type="checkbox" class="comm-wa-recipient-check" data-coupon="${coupon.number}" ${hasPhone ? 'checked' : 'disabled'}></td>
      <td>#${coupon.number}</td>
      <td><strong style="display:block; font-size:13px;">${escapeHtml(coupon.buyerName || "-")}</strong><span style="font-size:12px; color: var(--ink-secondary);">${escapeHtml(phone || "No phone number")}</span></td>
      <td><textarea readonly style="width: 100%; font-size: 11px; padding: 4px; border: 1px solid var(--line); border-radius: 4px; resize: none; background: var(--bg); height: 45px; font-family: monospace;">${escapeHtml(msgText)}</textarea></td>
      <td style="text-align: center;"><button type="button" class="comm-wa-single-send wa-btn" data-coupon="${coupon.number}" ${hasPhone ? '' : 'disabled'} style="padding: 4px 10px; font-size: 11px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></button></td>
    `;
    tbody.appendChild(row);
  });

  document.getElementById("commWaRecipientsSection").style.display = "block";
  document.getElementById("commWaRecipientsCount").textContent = `${withPhoneCount} recipient(s) with phone numbers`;
  document.getElementById("commWaPhoneWarning").style.display = hasMissingPhone ? "inline" : "none";
  document.getElementById("commWaSelectAll").checked = true;
  document.getElementById("commWaSendAll").classList.toggle("init-hidden", withPhoneCount === 0);
}

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


// ═══════════════════════════════════════════════
// 🚀 INIT NEW FEATURES
// ═══════════════════════════════════════════════

// Defer init until after Firebase loads
setTimeout(() => {
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
