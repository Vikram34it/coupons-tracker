const DEFAULT_TOTAL_COUPONS = 3000;
const STORAGE_KEY = "coupon-seva-tracker-v1";
const AUTH_KEY = "coupon-seva-session-v1";
const DEFAULT_ADMIN_PASSWORD = "hare krishna";

const state = loadState();
let session = loadSession();
let activeDevoteeTab = "pending";
let activeAdminTab = "dashboard";
let isEditing = false;
let pendingFirebaseData = null;
let saveTimer = null;
const els = {};

window.addEventListener("load", () => {
  cacheElements();
  bindEvents();
  initTheme();
  renderSelectors();
  render();
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
function defaultState(totalCoupons = DEFAULT_TOTAL_COUPONS) {
  return {
    settings: {
      adminPassword: DEFAULT_ADMIN_PASSWORD,
      totalCoupons,
      invitationMessage: "",
      viewerPassword: "",
      attendancePassword: ""
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
        viewerPassword: parsed.settings?.viewerPassword || "",
        attendancePassword: parsed.settings?.attendancePassword || ""
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

  (state.hundi || []).filter(h => h.settled).forEach(h => {
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
    "logoutBtn", "userBadge", "syncBadge", "csvBtn", "exportBtn", "pdfBtn", "importFile", "themeToggle", "totalCoupons", "assignedCoupons", "soldCoupons", "moneyReceived", "settledCoupons", "unsettledMoney",     "templeTransferMoney",
    "totalPresent", "totalAbsent",

    "devoteeForm", "devoteeName", "devoteeContact", "devoteePassword", "assignForm", "assignDevotee", "assignFrom",
    "assignTo", "assignDate", "assignHint", "couponSettingsForm", "totalCouponInput", "resetCouponForm", "resetCouponNumber", "resetDevotee", "resetCouponList",
    "selectAllResetCouponsBtn", "clearResetSelectionBtn", "resetSelectedCouponsBtn", "resetDevoteeCouponsBtn", "resetAllCouponsBtn",
    "adminPasswordForm", "adminPassword", "viewerPasswordForm", "viewerPasswordInput",
    "invitationForm", "invitationMessageInput", "previewInvitationBtn", "invitationSavedBadge",
    "adminPeriodSummary", "devoteeSearch", "devoteeStatusFilter", "dashboardDevoteeFilter", "settledFromDate", "settledToDate", "devoteeList", "entryDevotee", "devoteeStats", "entrySearch",
    "entryStatus", "entryList", "allSearch", "allStatus", "allDevoteeFilter", "allAttendance", "devoteePendingDisplay", "sevaSummary", "allCouponsBody", "toast",
    "analyticsTotalRevenue", "analyticsSoldCoupons", "analyticsPendingAmount", "analyticsActiveDevotees", "analyticsAvgSale",     "analyticsSettlementRate", "analyticsTempleTransfer", "analyticsHundiTotal", "sevaChart", "trendChart", "topDevotees", "topSevas",
    "bulkSelectAll", "selectAllVisibleBtn", "bulkSettleBtn",
    "attendancePasswordForm", "attendancePasswordInput",
    "attendanceSearch", "attendanceDevoteeFilter", "attendanceStatus", "attendanceBody", "markAllPresentBtn", "markAllAbsentBtn", "attendanceSummary"
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

function renderAttendanceDevoteeFilter() {
  if (!els.attendanceDevoteeFilter) return;

  const currentValue = els.attendanceDevoteeFilter.value;

  const sorted = [...state.devotees].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const options = [
    `<option value="all">All Devotees</option>`,
    ...sorted.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
  ];

  els.attendanceDevoteeFilter.innerHTML = options.join("");

  if (currentValue) {
    els.attendanceDevoteeFilter.value = currentValue;
    if (els.attendanceDevoteeFilter.value !== currentValue) {
      els.attendanceDevoteeFilter.value = "all";
    }
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateView(tab.dataset.view);
      document.querySelectorAll("[data-admin-tab]").forEach(t => t.classList.remove("active"));
      if (tab.dataset.view === "attendanceView") {
        renderAttendance();
      }
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
  els.attendancePasswordForm.addEventListener("submit", updateAttendancePassword);
  els.attendanceSearch.addEventListener("input", renderAttendance);
  els.attendanceDevoteeFilter.addEventListener("change", renderAttendance);
  els.attendanceStatus.addEventListener("change", renderAttendance);
  els.markAllPresentBtn?.addEventListener("click", markAllPresent);
  els.markAllAbsentBtn?.addEventListener("click", markAllAbsent);
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
  els.allAttendance?.addEventListener("change", renderAllCoupons);
  els.exportBtn.addEventListener("click", exportBackup);
  els.csvBtn.addEventListener("click", exportCsv);
  els.importFile.addEventListener("change", importBackup);
  els.themeToggle?.addEventListener("click", toggleTheme);
  els.pdfBtn?.addEventListener("click", generatePdfReport);
  els.bulkSelectAll?.addEventListener("change", () => {
    els.allCouponsBody.querySelectorAll(".bulk-coupon-check:not(:disabled)").forEach(cb => {
      cb.checked = els.bulkSelectAll.checked;
    });
  });
  els.selectAllVisibleBtn?.addEventListener("click", () => {
    els.allCouponsBody.querySelectorAll(".bulk-coupon-check:not(:disabled)").forEach(cb => {
      cb.checked = true;
    });
  });
  els.bulkSettleBtn?.addEventListener("click", bulkSettleSelected);

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      renderAnalytics(chip.dataset.filter);
    });
  });
  els.allDevoteeFilter.addEventListener("change", () => {
    renderAllCoupons();
    updateDevoteePendingDisplay();
  });

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
  } else if (role === "attendance") {
    if (!state.settings.attendancePassword) {
      showToast("Attendance password has not been set by admin yet");
      return;
    }
    if (password !== state.settings.attendancePassword) {
      showToast("Attendance password is incorrect");
      return;
    }
    saveSession({ role: "attendance", devoteeId: "" });
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
  els.loginDevoteeLabel.classList.toggle("hidden", !isDevotee);
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
    pin: password
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

function updateAttendancePassword(event) {
  event.preventDefault();
  const password = els.attendancePasswordInput.value.trim();
  if (password.length < 4) {
    showToast("Use at least 4 characters for attendance password");
    return;
  }
  state.settings.attendancePassword = password;
  els.attendancePasswordForm.reset();
  saveState();
  showToast("Attendance password set ✓");
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

  saveState();
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
  renderAttendanceDevoteeFilter();
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
  const isAttendance = session?.role === "attendance";
  const isDevotee = session?.role === "devotee";
  const activeDevotee = isDevotee
    ? state.devotees.find((devotee) => devotee.id === session.devoteeId)
    : null;

  // Badge label
  els.userBadge.textContent = isAdmin
    ? "👑 Admin"
    : isViewer
      ? "📊 Monitor"
      : isAttendance
        ? "📋 Attendance"
        : activeDevotee
          ? `Devotee: ${activeDevotee.name}`
          : "";

  // Export / import — admin only
  els.csvBtn.classList.toggle("hidden", !isAdmin);
  els.exportBtn.classList.toggle("hidden", !isAdmin);
  els.importFile.closest(".file-label").classList.toggle("hidden", !isAdmin);

  // Devotee entry dropdown
  els.entryDevotee.disabled = isDevotee;
  els.entryStatus.classList.toggle("hidden", isDevotee);
  if (isDevotee) els.entryStatus.value = "all";

  // All Coupons tab — visible to admin & viewer
  document.querySelector('[data-view="allCouponsView"]').classList.toggle("hidden", !isAdmin && !isViewer && !isAttendance);

  // Devotee Entry tab — hidden for viewer & attendance
  document.querySelector('[data-view="devoteeView"]')?.classList.toggle("hidden", isViewer || isAttendance);

  // Attendance tab — visible to admin & attendance role
  document.querySelector('[data-view="attendanceView"]').classList.toggle("hidden", !isAdmin && !isAttendance);

  // Admin sub-tabs: viewer & attendance see Analytics + Dashboard only
  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    const tabName = tab.dataset.adminTab;
    if (isViewer || isAttendance) {
      if (tabName === "setup" || tabName === "reset") {
        tab.classList.add("hidden");
      } else {
        tab.classList.remove("hidden");
      }
    } else if (isAdmin) {
      tab.classList.remove("hidden");
    } else {
      tab.classList.add("hidden");
    }
  });

  // Hide PDF button for viewer & attendance
  els.pdfBtn?.classList.toggle("hidden", !isAdmin);

  // Hide Mark All buttons for viewer
  els.markAllPresentBtn?.classList.toggle("hidden", isViewer);
  els.markAllAbsentBtn?.classList.toggle("hidden", isViewer);

  // Viewer: land on Analytics dashboard
  if (isViewer) {
    const allCouponsActive = document.getElementById("allCouponsView")?.classList.contains("active");
    if (!allCouponsActive) {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      document.getElementById("adminView")?.classList.add("active");
      activeAdminTab = "analytics";
      updateAdminView();
    }
  }

  // Attendance: land on Attendance view
  if (isAttendance) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    document.getElementById("topbar")?.classList.remove("hidden");
    document.querySelector('[data-view="attendanceView"]').classList.add("active");
    document.getElementById("attendanceView")?.classList.add("active");
    renderSelectors();
    renderAttendanceDevoteeFilter();
    renderAttendance();
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
  const assigned = state.coupons.filter((coupon) => coupon.devoteeId).length;
  const sold = state.coupons.filter(isSold).length;
  const settled = state.coupons.filter((coupon) => coupon.settled).length;

  // Only settled coupons + hundi count as received
  const settledMoney = state.coupons
    .filter(c => c.settled)
    .reduce((sum, c) => sum + amountValue(c.amount), 0);
  const hundiMoney = (state.hundi || []).filter(h => h.settled).reduce((sum, h) => sum + h.amount, 0);

  // Unsettled = sold but not yet settled
  const unsettledMoney = state.coupons
    .filter(c => isSold(c) && !c.settled)
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  const templeTransfer = state.coupons
    .filter(c => c.paymentMode === "temple_transfer" && isSold(c))
    .reduce((sum, c) => sum + amountValue(c.amount), 0);

  const totalPresent = state.coupons.filter(c => isSold(c) && c.present === true).length;
  const totalAbsent = state.coupons.filter(c => isSold(c) && c.present === false).length;

  els.totalCoupons.textContent = couponTotal().toLocaleString("en-IN");
  els.assignedCoupons.textContent = assigned.toLocaleString("en-IN");
  els.soldCoupons.textContent = sold.toLocaleString("en-IN");
  els.moneyReceived.textContent = formatMoney(settledMoney + hundiMoney);
  els.settledCoupons.textContent = settled.toLocaleString("en-IN");
  if (els.unsettledMoney) els.unsettledMoney.textContent = formatMoney(unsettledMoney);
  if (els.templeTransferMoney) els.templeTransferMoney.textContent = formatMoney(templeTransfer);
  if (els.totalPresent) els.totalPresent.textContent = totalPresent.toLocaleString("en-IN");
  if (els.totalAbsent) els.totalAbsent.textContent = totalAbsent.toLocaleString("en-IN");
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

        let couponRanges = [];
        if (couponNumbers.length > 0) {
          let start = couponNumbers[0];
          let prev = couponNumbers[0];
          for (let i = 1; i < couponNumbers.length; i++) {
            if (couponNumbers[i] === prev + 1) {
              prev = couponNumbers[i];
            } else {
              couponRanges.push(start === prev ? `${start}` : `${start}-${prev}`);
              start = couponNumbers[i];
              prev = couponNumbers[i];
            }
          }
          couponRanges.push(start === prev ? `${start}` : `${start}-${prev}`);
        }
        const couponList = couponRanges.length > 0 ? couponRanges.join(", ") : "None";

        const message =
          `Hare Krishna 🙏

${devotee.name},

Here is your seva summary:

🔐 PIN: ${devotee.pin || "Not set"}

🎟 Coupons Assigned: ${assignedCount}
📋 Coupon Numbers: ${couponList}
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

        const url =
          `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;

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
        settled: false
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
              <td>${formatMoney(coupon.amount)}</td>
              <td>${escapeHtml(coupon.description || "-")}</td>
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

    // Wire up send buttons
    els.entryList.querySelectorAll("[data-wa-coupon]").forEach(btn => {
      btn.addEventListener("click", () => {
        const coupon = state.coupons[Number(btn.dataset.waCoupon) - 1];
        openWhatsAppForBuyer(coupon);
      });
    });

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
      : activeDevoteeTab === "sold"
        ? `<div class="empty">No sold coupons found.</div>`
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
  const attendance = els.allAttendance?.value || "all";
  let coupons = state.coupons;

  if (status === "unassigned") coupons = coupons.filter((coupon) => !coupon.devoteeId);
  if (status === "assigned") coupons = coupons.filter((coupon) => coupon.devoteeId);
  if (status === "sold") coupons = coupons.filter(isSold);
  if (status === "settled") coupons = coupons.filter((coupon) => coupon.settled);
  if (status === "unsettled") coupons = coupons.filter((coupon) => coupon.devoteeId && !coupon.settled);
  if (status === "sold_unsettled") {
    coupons = coupons.filter(c =>
      c.devoteeId &&
      isSold(c) &&
      !c.settled &&
      amountValue(c.amount) > 0
    );
  }

  if (attendance === "present") coupons = coupons.filter(c => c.present);
  if (attendance === "absent") coupons = coupons.filter(c => !c.present);

  const devoteeFilter = els.allDevoteeFilter?.value;
  if (devoteeFilter && devoteeFilter !== "all") {
    coupons = coupons.filter(c => c.devoteeId === devoteeFilter);
  }
  if (query) coupons = coupons.filter((coupon) => couponSearchText(coupon).includes(query));

  const canMarkAttendance = session?.role === "admin" || session?.role === "viewer";

  els.allCouponsBody.innerHTML = coupons.map((coupon) => {
    return `
    <tr>
      <td><input type="checkbox" class="bulk-coupon-check" data-coupon-num="${coupon.number}" ${coupon.settled ? "disabled" : ""}></td>
      <td>#${coupon.number}</td>
      <td>${escapeHtml(devoteeName(coupon.devoteeId) || "-")}</td>
      <td>${escapeHtml(coupon.assignedAt || "-")}</td>
      <td>${escapeHtml(coupon.buyerName || "-")}</td>
      <td>${escapeHtml(coupon.buyerContact || "-")}</td>
      <td>${coupon.amount ? escapeHtml(formatMoney(amountValue(coupon.amount))) : "-"}</td>
      <td>${escapeHtml(coupon.receiptNumber || "-")}</td>
      <td>${coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash"}</td>
      <td>
        <span class="status ${coupon.settled ? 'settled' : 'pending'}">${coupon.settled ? "\u2713 Settled" : "Pending"}</span>
      </td>
      <td>${escapeHtml(coupon.settledAt || "-")}</td>
      <td>${escapeHtml(coupon.description || "-")}</td>
      <td>
        ${(coupon.settled && coupon.buyerContact)
        ? `<button class="wa-btn" type="button" data-wa-coupon="${coupon.number}">Send</button>`
        : `<span class="small-stat">\u2013</span>`
        }
      </td>
      <td>
        ${canMarkAttendance
        ? `<span class="att-toggle">
             <button class="att-p ${coupon.present === true ? 'active' : ''}" type="button" data-att-present="${coupon.number}" data-val="true" title="Present">P</button>
             <button class="att-a ${coupon.present === false ? 'active' : ''}" type="button" data-att-present="${coupon.number}" data-val="false" title="Absent">A</button>
           </span>`
        : `<span class="status ${coupon.present === true ? 'settled' : coupon.present === false ? 'att-absent-badge' : 'pending'}">${coupon.present === true ? 'P' : coupon.present === false ? 'A' : '-'}</span>`
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

  // Wire up Present/Absent buttons in All Coupons
  els.allCouponsBody.querySelectorAll("[data-att-present]").forEach(btn => {
    btn.addEventListener("click", () => {
      const num = Number(btn.dataset.attPresent);
      const coupon = state.coupons[num - 1];
      if (!coupon) return;
      const newVal = btn.dataset.val === "true";
      coupon.present = newVal;
      coupon.presentAt = newVal ? todayKey() : "";
      saveState();
      renderStats();
      renderAllCoupons();
      showToast(`Coupon #${num} marked ${newVal ? "Present" : "Absent"}`);
    });
  });
}

function bulkSettleSelected() {
  if (session?.role !== "admin") {
    showToast("Only admin can settle coupons");
    return;
  }

  const selected = els.allCouponsBody
    ? Array.from(els.allCouponsBody.querySelectorAll(".bulk-coupon-check:checked"))
        .map(cb => Number(cb.dataset.couponNum))
        .filter(Boolean)
    : [];

  if (!selected.length) {
    showToast("Select coupons to settle");
    return;
  }

  const unsettled = selected.filter(n => {
    const c = state.coupons[n - 1];
    return c && !c.settled;
  });

  console.log("Unsettled coupons:", unsettled);

if (!unsettled.length) {
    showToast("All selected coupons are already settled");
    return;
  }

  const confirmed = window.confirm(
    `Mark ${unsettled.length} coupon(s) as settled?`
  );
  if (!confirmed) return;

  unsettled.forEach(n => {
    const c = state.coupons[n - 1];
    if (c) {
      c.settled = true;
      c.settledAt = c.settledAt || todayKey();
    }
  });

  console.log("After settle, state.coupons sample:", state.coupons.slice(0, 5));
  saveState();
  renderStats();
  renderDevotees();
  renderSevaSummary();
  updateDevoteePendingDisplay();
  renderAllCoupons();
  showToast(`${unsettled.length} coupon(s) settled`);
}

function markAllPresent() {
  if (session?.role !== "admin" && session?.role !== "attendance") {
    showToast("Only admin or attendance can mark attendance");
    return;
  }
  bulkMarkAttendance(true);
}

function markAllAbsent() {
  if (session?.role !== "admin" && session?.role !== "attendance") {
    showToast("Only admin or attendance can mark attendance");
    return;
  }
  bulkMarkAttendance(false);
}

function bulkMarkAttendance(markPresent) {
  const search = (els.attendanceSearch?.value || "").toLowerCase().trim();
  const devoteeFilter = els.attendanceDevoteeFilter?.value || "all";
  const statusFilter = els.attendanceStatus?.value || "all";

  let coupons = state.coupons.filter(c => isSold(c));

  if (devoteeFilter !== "all") {
    coupons = coupons.filter(c => c.devoteeId === devoteeFilter);
  }

  if (statusFilter === "present") coupons = coupons.filter(c => c.present === true);
  else if (statusFilter === "absent") coupons = coupons.filter(c => c.present === false);
  else if (statusFilter === "unmarked") coupons = coupons.filter(c => c.present === undefined || c.present === null);

  if (search) {
    coupons = coupons.filter(c => {
      const devotee = state.devotees.find(d => d.id === c.devoteeId);
      return `${c.number} ${c.buyerName || ""} ${c.buyerContact || ""} ${c.description || ""} ${devotee?.name || ""}`.toLowerCase().includes(search);
    });
  }

  if (!coupons.length) {
    showToast("No coupons found to mark");
    return;
  }

  const confirmed = window.confirm(`Mark ${coupons.length} coupon(s) as ${markPresent ? "Present" : "Absent"}?`);
  if (!confirmed) return;

  coupons.forEach(c => {
    c.present = markPresent;
    c.presentAt = markPresent ? todayKey() : "";
  });

  saveState();
  renderStats();
  renderAttendance();
  renderAllCoupons();
  showToast(`${coupons.length} coupon(s) marked ${markPresent ? "Present" : "Absent"}`);
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

function updateCouponField(event) {
  const field = event.target;

  const card = field.closest("[data-coupon-number]");
  const coupon = state.coupons[Number(card.dataset.couponNumber) - 1];

  if (session?.role === "devotee" && coupon.devoteeId !== session.devoteeId) {
    showToast("This coupon is not assigned to this devotee");
    return;
  }

  coupon[field.dataset.field] = field.value.trimStart();

  // 🔥 DELAY SAVE (KEY FIX)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState();   // only after user pauses
  }, 500);

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
    present: false,
    presentAt: ""
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
      present: Boolean(savedCoupon.present),
      presentAt: savedCoupon.presentAt || ""
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
  return Boolean(coupon.buyerName || coupon.buyerContact || amountValue(coupon.amount) > 0);
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
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.devotees) || !Array.isArray(imported.coupons)) {
        throw new Error("Invalid backup");
      }

      state.settings = {
        adminPassword: imported.settings?.adminPassword || state.settings.adminPassword || DEFAULT_ADMIN_PASSWORD,
        totalCoupons: positiveInteger(imported.settings?.totalCoupons) || imported.coupons.length || DEFAULT_TOTAL_COUPONS,
        invitationMessage: imported.settings?.invitationMessage || state.settings.invitationMessage || "",
        viewerPassword: imported.settings?.viewerPassword || state.settings.viewerPassword || "",
        attendancePassword: imported.settings?.attendancePassword || state.settings.attendancePassword || ""
      };
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
    pin: devotee.pin || ""
  };
}

function toggleTheme() {
  const html = document.documentElement;
  const currentTheme = html.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", newTheme);
  localStorage.setItem("coupon-tracker-theme", newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById("themeIcon");
  if (!icon) return;
  if (theme === "dark") {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem("coupon-tracker-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = savedTheme || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}

// ================= PDF REPORT =================
function generatePdfReport() {
  const period = settlementPeriod();
  const reportDate = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric"
  });

  const settledCoupons = state.coupons.filter(c => c.settled && inSettlementPeriod(c, period));
  const allSoldCoupons = state.coupons.filter(c => isSold(c));
  const totalRevenue = settledCoupons.reduce((sum, c) => sum + amountValue(c.amount), 0);
  const hundiTotal = (state.hundi || []).filter(h => h.settled).reduce((sum, h) => sum + h.amount, 0);

  const devoteeSummaryList = state.devotees.map(devotee => {
    const summary = devoteeSummary(devotee.id, period);
    return {
      name: devotee.name,
      contact: devotee.contact,
      issued: summary.issued,
      sold: summary.sold,
      settled: formatMoney(summary.settledAmount),
      pending: formatMoney(summary.pendingAmount)
    };
  }).sort((a, b) => parseInt(b.settled.replace(/[^\d]/g, "")) - parseInt(a.settled.replace(/[^\d]/g, "")));

  const couponDetails = allSoldCoupons.map(coupon => {
    const devotee = state.devotees.find(d => d.id === coupon.devoteeId);
    return {
      number: coupon.number,
      devotee: devotee ? devotee.name : "-",
      buyerName: coupon.buyerName || "-",
      buyerContact: coupon.buyerContact || "-",
      amount: coupon.amount ? formatMoney(amountValue(coupon.amount)) : "-",
      description: coupon.description || "-",
      paymentMode: coupon.paymentMode === "temple_transfer" ? "Temple Transfer" : "Cash",
      settled: coupon.settled ? "Yes" : "No",
      settledAt: coupon.settledAt || "-"
    };
  });

  let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Coupon Seva Report</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; padding: 20px; color: #1a1a1a; }
        .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #0d9488; }
        .header h1 { color: #0d9488; font-size: 28px; margin-bottom: 8px; }
        .header p { color: #666; font-size: 14px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 30px; }
        .summary-card { background: #f8f7f4; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #e8e6e1; }
        .summary-card span { font-size: 12px; color: #666; }
        .summary-card strong { display: block; font-size: 22px; color: #0d9488; margin-top: 4px; }
        h3 { margin: 30px 0 12px; color: #0d9488; font-size: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { background: #0d9488; color: white; padding: 10px 8px; text-align: left; font-size: 10px; }
        td { padding: 8px; border-bottom: 1px solid #e8e6e1; }
        tr:nth-child(even) { background: #faf9f7; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #999; }
        .page-break { page-break-before: always; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Coupon Seva Report</h1>
        <p>Generated on ${reportDate}</p>
        <p>Period: ${period.label}</p>
      </div>
      <div class="summary-grid">
        <div class="summary-card"><span>Total Revenue</span><strong>${formatMoney(totalRevenue + hundiTotal)}</strong></div>
        <div class="summary-card"><span>Settled Coupons</span><strong>${settledCoupons.length}</strong></div>
        <div class="summary-card"><span>Sold Coupons</span><strong>${allSoldCoupons.length}</strong></div>
        <div class="summary-card"><span>Active Devotees</span><strong>${state.devotees.length}</strong></div>
      </div>
      <h3>Devotee Summary</h3>
      <table>
        <thead><tr><th>Devotee</th><th>Contact</th><th>Issued</th><th>Sold</th><th>Settled</th><th>Pending</th></tr></thead>
        <tbody>
          ${devoteeSummaryList.map(d => `
            <tr>
              <td>${d.name}</td>
              <td>${d.contact || "-"}</td>
              <td>${d.issued}</td>
              <td>${d.sold}</td>
              <td>${d.settled}</td>
              <td>${d.pending}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="page-break"></div>
      <h3>Coupon Details (${couponDetails.length} coupons)</h3>
      <table>
        <thead><tr><th>#</th><th>Devotee</th><th>Buyer</th><th>Contact</th><th>Amount</th><th>Seva</th><th>Payment</th><th>Settled</th><th>Date</th></tr></thead>
        <tbody>
          ${couponDetails.map(c => `
            <tr>
              <td>${c.number}</td>
              <td>${c.devotee}</td>
              <td>${c.buyerName}</td>
              <td>${c.buyerContact}</td>
              <td>${c.amount}</td>
              <td>${c.description}</td>
              <td>${c.paymentMode}</td>
              <td>${c.settled}</td>
              <td>${c.settledAt}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="footer">
        <p>Coupon Seva Tracker | Generated automatically</p>
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(htmlContent);
  printWindow.document.close();
  printWindow.print();

  showToast("PDF report generated");
}

// ================= ANALYTICS =================
function renderAnalytics(filter = "all") {
  const period = getAnalyticsPeriod(filter);

  const filteredCoupons = state.coupons.filter(coupon =>
    coupon.settled && inSettlementPeriod(coupon, period)
  );

  const totalRevenue = filteredCoupons.reduce((sum, c) => sum + amountValue(c.amount), 0);
  const soldCoupons = filteredCoupons.length;
  const activeDevotees = new Set(filteredCoupons.map(c => c.devoteeId).filter(Boolean)).size;

  const allSoldCoupons = state.coupons.filter(c => isSold(c));
  const pendingAmount = allSoldCoupons.filter(c => !c.settled).reduce((sum, c) => sum + amountValue(c.amount), 0);

  const avgSale = soldCoupons > 0 ? Math.round(totalRevenue / soldCoupons) : 0;
  const settlementRate = allSoldCoupons.length > 0
    ? Math.round((allSoldCoupons.filter(c => c.settled).length / allSoldCoupons.length) * 100)
    : 0;

  const templeTransfer = allSoldCoupons.filter(c => c.paymentMode === "temple_transfer").reduce((sum, c) => sum + amountValue(c.amount), 0);
  const hundiTotal = (state.hundi || []).filter(h => h.settled).reduce((sum, h) => sum + h.amount, 0);

  if (els.analyticsTotalRevenue) els.analyticsTotalRevenue.textContent = formatMoney(totalRevenue + hundiTotal);
  if (els.analyticsSoldCoupons) els.analyticsSoldCoupons.textContent = soldCoupons.toLocaleString("en-IN");
  if (els.analyticsPendingAmount) els.analyticsPendingAmount.textContent = formatMoney(pendingAmount);
  if (els.analyticsActiveDevotees) els.analyticsActiveDevotees.textContent = activeDevotees.toLocaleString("en-IN");
  if (els.analyticsAvgSale) els.analyticsAvgSale.textContent = formatMoney(avgSale);
  if (els.analyticsSettlementRate) els.analyticsSettlementRate.textContent = `${settlementRate}%`;
  if (els.analyticsTempleTransfer) els.analyticsTempleTransfer.textContent = formatMoney(templeTransfer);
  if (els.analyticsHundiTotal) els.analyticsHundiTotal.textContent = formatMoney(hundiTotal);

  renderSevaDistributionChart();
  renderTrendChart(filter);
  renderTopPerformers();
  renderTopSevas();
}

function getAnalyticsPeriod(filter) {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  switch (filter) {
    case "today": return { from: today, to: today, label: "Today" };
    case "week":
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      return { from: weekStart.toISOString().split("T")[0], to: today, label: "This Week" };
    case "month":
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: monthStart.toISOString().split("T")[0], to: today, label: "This Month" };
    case "year":
      const yearStart = new Date(now.getFullYear(), 0, 1);
      return { from: yearStart.toISOString().split("T")[0], to: today, label: "This Year" };
    default: return { from: "", to: "", label: "All Time" };
  }
}

function renderSevaDistributionChart() {
  if (!els.sevaChart) return;

  const suaMap = {};
  state.coupons.filter(c => c.settled).forEach(coupon => {
    const sua = coupon.description || "Others";
    suaMap[sua] = (suaMap[sua] || 0) + amountValue(coupon.amount);
  });

  const entries = Object.entries(suaMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxValue = entries.length > 0 ? Math.max(...entries.map(e => e[1])) : 1;
  const colors = ["#0d9488", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

  els.sevaChart.innerHTML = `<div class="bar-chart">${entries.map(([sua, amount], i) => `
    <div class="bar-item">
      <div class="bar" style="height: ${(amount / maxValue) * 100}px; background: ${colors[i % colors.length]}"></div>
      <span class="bar-label">${sua.substring(0, 8)}</span>
      <span style="font-size: 10px; font-weight: 600;">${formatMoney(amount)}</span>
    </div>
  `).join("")}</div>`;
}

function renderTrendChart(filter) {
  if (!els.trendChart) return;

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    last7Days.push(date.toISOString().split("T")[0]);
  }

  const dailyData = last7Days.map(date =>
    state.coupons.filter(c => c.settled && c.settledAt === date).reduce((sum, c) => sum + amountValue(c.amount), 0)
  );

  const maxValue = Math.max(...dailyData, 1);

  els.trendChart.innerHTML = `<div class="bar-chart">${dailyData.map((amount, i) => `
    <div class="bar-item">
      <div class="bar" style="height: ${(amount / maxValue) * 100}px"></div>
      <span class="bar-label">${last7Days[i].slice(5)}</span>
    </div>
  `).join("")}</div>`;
}

function renderTopPerformers() {
  const topDevoteesEl = document.getElementById("topDevotees");
  if (!topDevoteesEl) return;

  const devoteeStats = state.devotees.map(devotee => {
    const settled = state.coupons.filter(c => c.devoteeId === devotee.id && c.settled).reduce((sum, c) => sum + amountValue(c.amount), 0);
    return { name: devotee.name, amount: settled };
  }).filter(d => d.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 5);

  if (devoteeStats.length === 0) {
    topDevoteesEl.innerHTML = '<div class="empty">No data available</div>';
    return;
  }

  const rankClasses = ["gold", "silver", "bronze", "", ""];
  topDevoteesEl.innerHTML = devoteeStats.map((d, i) => `
    <div class="top-item">
      <div class="top-item-rank ${rankClasses[i]}">${i + 1}</div>
      <span class="top-item-name">${escapeHtml(d.name)}</span>
      <span class="top-item-value">${formatMoney(d.amount)}</span>
    </div>
  `).join("");
}

function renderTopSevas() {
  const topSevasEl = document.getElementById("topSevas");
  if (!topSevasEl) return;

  const suaMap = {};
  state.coupons.filter(c => c.settled).forEach(coupon => {
    const sua = coupon.description || "Others";
    suaMap[sua] = (suaMap[sua] || 0) + amountValue(coupon.amount);
  });

  const entries = Object.entries(suaMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (entries.length === 0) {
    topSevasEl.innerHTML = '<div class="empty">No data available</div>';
    return;
  }

  const rankClasses = ["gold", "silver", "bronze", "", ""];
  topSevasEl.innerHTML = entries.map(([sua, amount], i) => `
    <div class="top-item">
      <div class="top-item-rank ${rankClasses[i]}">${i + 1}</div>
      <span class="top-item-name">${escapeHtml(sua)}</span>
      <span class="top-item-value">${formatMoney(amount)}</span>
    </div>
  `).join("");
}

// ================= ATTENDANCE VIEW =================

function renderAttendance() {
  const tbody = document.getElementById("attendanceBody");
  const summaryEl = document.getElementById("attendanceSummary");
  if (!tbody) return;

  const search = (els.attendanceSearch?.value || "").toLowerCase().trim();
  const devoteeFilter = els.attendanceDevoteeFilter?.value || "all";
  const statusFilter = els.attendanceStatus?.value || "all";
  const canMark = session?.role === "admin" || session?.role === "attendance";

  let coupons = state.coupons.filter(c => isSold(c));

  if (devoteeFilter !== "all") {
    coupons = coupons.filter(c => c.devoteeId === devoteeFilter);
  }

  if (statusFilter === "present") coupons = coupons.filter(c => c.present === true);
  else if (statusFilter === "absent") coupons = coupons.filter(c => c.present === false);
  else if (statusFilter === "unmarked") coupons = coupons.filter(c => c.present === undefined || c.present === null);

  if (search) {
    coupons = coupons.filter(c => {
      const devotee = state.devotees.find(d => d.id === c.devoteeId);
      return `${c.number} ${c.buyerName || ""} ${c.buyerContact || ""} ${c.description || ""} ${devotee?.name || ""}`.toLowerCase().includes(search);
    });
  }

  const totalSold = state.coupons.filter(isSold).length;
  const totalPresent = state.coupons.filter(c => isSold(c) && c.present === true).length;
  const totalAbsent = state.coupons.filter(c => isSold(c) && c.present === false).length;
  const totalUnmarked = totalSold - totalPresent - totalAbsent;

  if (summaryEl) {
    summaryEl.textContent = `Total Sold: ${totalSold} | Present: ${totalPresent} | Absent: ${totalAbsent} | Unmarked: ${totalUnmarked}`;
  }

  coupons.sort((a, b) => {
    const dateComp = (b.settledAt || b.assignedAt || "").localeCompare(a.settledAt || a.assignedAt || "");
    if (dateComp !== 0) return dateComp;
    return a.number - b.number;
  });

  if (!coupons.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted)">No sold coupons found.</td></tr>`;
    return;
  }

  tbody.innerHTML = coupons.map(coupon => {
    const devotee = state.devotees.find(d => d.id === coupon.devoteeId);
    const devoteeName = devotee ? devotee.name : "-";
    const date = coupon.settledAt || coupon.assignedAt || "-";
    const pClass = coupon.present === true ? "att-p-active" : coupon.present === false ? "att-a-active" : "att-none";
    const attLabel = coupon.present === true ? "P" : coupon.present === false ? "A" : "-";

    return `
      <tr class="att-row-${pClass}">
        <td><strong>#${coupon.number}</strong></td>
        <td>${escapeHtml(coupon.buyerName || "-")}</td>
        <td>${escapeHtml(coupon.buyerContact || "-")}</td>
        <td>${escapeHtml(coupon.description || "-")}</td>
        <td>${coupon.amount ? formatMoney(amountValue(coupon.amount)) : "-"}</td>
        <td>
          ${canMark
            ? `<span class="att-toggle" data-att-num="${coupon.number}">
                 <button class="att-p ${coupon.present === true ? "active" : ""}" type="button" data-att="true" title="Present">P</button>
                 <button class="att-a ${coupon.present === false ? "active" : ""}" type="button" data-att="false" title="Absent">A</button>
               </span>`
            : `<span class="att-label att-label-${pClass}">${attLabel}</span>`
          }
        </td>
        <td>${escapeHtml(devoteeName)}</td>
        <td>${escapeHtml(date)}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-att]").forEach(btn => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".att-toggle");
      const num = Number(wrap?.dataset.attNum);
      const coupon = state.coupons[num - 1];
      if (!coupon) return;

      const newVal = btn.dataset.att === "true";
      coupon.present = newVal;
      coupon.presentAt = newVal ? todayKey() : "";

      saveState();
      renderStats();
      renderAttendance();
      renderAllCoupons();
      showToast(`Coupon #${num} marked ${newVal ? "Present" : "Absent"}`);
    });
  });
}

// ================= FIREBASE SYNC =================

let firebaseReady = false;
let dbRef = null;
let firebaseVersion = 0;
let isSyncingFromFirebase = false;

function updateSyncBadge(text) {
  const badge = els.syncBadge || document.getElementById("syncBadge");
  if (badge) badge.textContent = text;
}

function mergeFirebaseData(data) {
  if (!data) return;

  if (data.settings) {
    state.settings = { ...state.settings, ...data.settings };
  }
  if (Array.isArray(data.devotees)) {
    const incomingIds = new Set(data.devotees.map(d => d.id));
    const localIds = new Set(state.devotees.map(d => d.id));

    const mergedDevotees = [...state.devotees];
    data.devotees.forEach(incoming => {
      if (localIds.has(incoming.id)) {
        const idx = mergedDevotees.findIndex(d => d.id === incoming.id);
        if (idx >= 0) {
          mergedDevotees[idx] = { ...mergedDevotees[idx], ...incoming };
        }
      } else {
        mergedDevotees.push(normalizeDevotee(incoming));
      }
    });
    state.devotees = mergedDevotees;
  }
  if (Array.isArray(data.coupons)) {
    const totalCoupons = couponTotal();
    const mergedCoupons = [...state.coupons];
    data.coupons.forEach((incoming, idx) => {
      if (idx < totalCoupons) {
        const local = mergedCoupons[idx];
        const hasLocalData = hasCouponData(local);
        const hasIncomingData = hasCouponData(incoming);

        if (hasIncomingData) {
          if (hasLocalData) {
            const incomingSettledAt = incoming.settledAt || "";
            const localSettledAt = local.settledAt || "";
            if (incomingSettledAt >= localSettledAt) {
              mergedCoupons[idx] = { ...local, ...incoming };
            }
          } else {
            mergedCoupons[idx] = { ...local, ...incoming };
          }
        }
      }
    });
    state.coupons = mergedCoupons;
  }
  if (Array.isArray(data.hundi)) {
    const mergedHundi = [...state.hundi];
    data.hundi.forEach(incoming => {
      const idx = mergedHundi.findIndex(h => h.id === incoming.id);
      if (idx >= 0) {
        mergedHundi[idx] = { ...mergedHundi[idx], ...incoming };
      } else {
        mergedHundi.push({ settled: false, ...incoming });
      }
    });
    state.hundi = mergedHundi;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderSelectors();
  render();
}

function applyPendingFirebaseData() {
  if (!pendingFirebaseData) return;
  const data = pendingFirebaseData;
  pendingFirebaseData = null;
  mergeFirebaseData(data);
}

function updateAdminView() {
  const adminView = document.getElementById("adminView");
  if (!adminView || !adminView.classList.contains("active")) return;

  document.querySelectorAll("[data-admin-section]").forEach(section => {
    if (section.dataset.adminSection === activeAdminTab) {
      section.style.display = "block";
    } else {
      section.style.display = "none";
    }
  });

  if (activeAdminTab === "analytics") {
    renderAnalytics("all");
  }
}

function syncToFirebase() {
  if (!firebaseReady || !dbRef || isSyncingFromFirebase) return;

  firebaseVersion++;
  const version = firebaseVersion;

  dbRef.transaction((current) => {
    if (current === null) return state;

    const merged = JSON.parse(JSON.stringify(current));

    merged.settings = { ...current.settings, ...state.settings };

    if (Array.isArray(merged.devotees)) {
      const incomingIds = new Set(merged.devotees.map(d => d.id));
      state.devotees.forEach(local => {
        if (incomingIds.has(local.id)) {
          const idx = merged.devotees.findIndex(d => d.id === local.id);
          if (idx >= 0) {
            merged.devotees[idx] = { ...merged.devotees[idx], ...local };
          }
        } else {
          merged.devotees.push(local);
        }
      });
    } else {
      merged.devotees = state.devotees;
    }

    if (Array.isArray(merged.coupons)) {
      state.coupons.forEach((local, idx) => {
        if (idx < merged.coupons.length) {
          const remote = merged.coupons[idx];
          const hasLocalData = hasCouponData(local);
          const hasRemoteData = hasCouponData(remote);

          if (hasLocalData && !hasRemoteData) {
            merged.coupons[idx] = local;
          } else if (hasLocalData && hasRemoteData) {
            const remoteSettledAt = remote.settledAt || "";
            const localSettledAt = local.settledAt || "";
            merged.coupons[idx] = localSettledAt >= remoteSettledAt ? local : remote;
          }
        } else {
          merged.coupons.push(local);
        }
      });
    } else {
      merged.coupons = state.coupons;
    }

    if (Array.isArray(merged.hundi)) {
      state.hundi.forEach(local => {
        const idx = merged.hundi.findIndex(h => h.id === local.id);
        if (idx >= 0) {
          merged.hundi[idx] = { ...merged.hundi[idx], ...local };
        } else {
          merged.hundi.push(local);
        }
      });
    } else {
      merged.hundi = state.hundi;
    }

    return merged;
  }).then((result) => {
    if (!result.committed) {
      firebaseVersion = version;
    }
  }).catch((err) => {
    console.error("Firebase sync error:", err);
    firebaseVersion = version;
  });
}

function initFirebaseSync() {
  try {
    if (!window.firebase || !window.COUPON_TRACKER_FIREBASE?.config?.databaseURL) {
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

        dbRef.on("value", (snapshot) => {
          if (!snapshot.exists()) {
            dbRef.set(state);
            return;
          }

          if (isEditing) {
            pendingFirebaseData = snapshot.val();
            return;
          }

          isSyncingFromFirebase = true;
          mergeFirebaseData(snapshot.val());
          isSyncingFromFirebase = false;
        });

        updateSyncBadge("Realtime");
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

const _origSaveState = saveState;
let _isSaving = false;
function saveState() {
  if (_isSaving) return;
  _isSaving = true;
  try {
    _origSaveState();
    if (firebaseReady && !isSyncingFromFirebase) {
      syncToFirebase();
    }
  } finally {
    _isSaving = false;
  }
}
