const DEFAULT_TOTAL_COUPONS = 3000;
const STORAGE_KEY = "coupon-seva-tracker-v1";
const AUTH_KEY = "coupon-seva-session-v1";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const DEFAULT_VIEWER_PASSWORD = "viewer123";

const state = loadState();
let session = loadSession();
let activeDevoteeTab = "pending";
let activeAdminTab = "dashboard";
let isEditing = false;
let pendingFirebaseData = null;
const els = {};

window.addEventListener("load", () => {
  cacheElements();
  bindEvents();
    renderSelectors(); // ✅ ADD THIS
  render();
document.addEventListener("focusin", (e) => {
  if (e.target.matches("input, textarea, select")) {
    isEditing = true;
  }
});

document.addEventListener("focusout", (e) => {
  if (e.target.matches("input, textarea, select")) {
    isEditing = false;
    applyPendingFirebaseData();
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
  viewerPassword: DEFAULT_VIEWER_PASSWORD,
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
      devotees: parsed.devotees.map(normalizeDevotee),
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
    "logoutBtn", "userBadge", "csvBtn", "exportBtn", "importFile", "totalCoupons", "assignedCoupons", "soldCoupons", "moneyReceived", "settledCoupons",
    "devoteeForm", "devoteeName", "devoteeContact", "devoteePassword", "assignForm", "assignDevotee", "assignFrom",
    "assignTo", "assignDate", "assignHint", "couponSettingsForm", "totalCouponInput", "resetCouponForm", "resetCouponNumber", "resetDevotee", "resetCouponList",
    "selectAllResetCouponsBtn", "clearResetSelectionBtn", "resetSelectedCouponsBtn", "resetDevoteeCouponsBtn", "resetAllCouponsBtn",
    "adminPasswordForm", "adminPassword", "adminPeriodSummary", "devoteeSearch", "settledFromDate", "settledToDate", "devoteeList", "entryDevotee", "devoteeStats", "entrySearch",
    "entryStatus", "entryList", "allSearch", "allStatus", "sevaSummary", "allCouponsBody", "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateView(tab.dataset.view);
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
}
else if (role === "viewer") {
  if (password !== state.settings.viewerPassword) {
    showToast("Viewer password is incorrect");
    return;
  }
  saveSession({ role: "viewer", devoteeId: "" });
}
else {
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
  if (!window.confirm(`${message} This will clear buyer details, amount, description, and settlement.`)) return;
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

  state.coupons.forEach((coupon) => {
    if (coupon.number >= from && coupon.number <= to) {
      coupon.devoteeId = devoteeId;
      coupon.assignedAt = assignedAt;
    }
  });

  els.assignForm.reset();
  els.assignHint.textContent = "";
  saveState();
  render();
  showToast(`Assigned coupons ${from} to ${to}`);
}

function render() {
  validateSession();
  renderSelectors();
  applyRoleAccess();
  renderStats();
  renderDevotees();
  renderSevaSummary();
  renderResetCouponList();
  renderEntryList();
  renderAllCoupons();
  updateAdminView();

const topStats = document.querySelector(".stats-grid");

if (topStats) {
  if (session?.role === "devotee") {
    // 🔥 ALWAYS HIDE (all tabs including dashboard)
    topStats.style.display = "none";
  } else {
    // ✅ Admin always sees it
    topStats.style.display = "grid";
  }
}
}

function renderSelectors() {

  // ✅ SORT DEVOTEES A–Z
  const sortedDevotees = [...state.devotees].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  const options = sortedDevotees
    .map((devotee) => `<option value="${escapeAttr(devotee.id)}">${escapeHtml(devotee.name)}</option>`)
    .join("");

  const empty = '<option value="">Select devotee</option>';

  // ✅ LOGIN DROPDOWN (THIS WAS YOUR MAIN REQUIREMENT)
  els.loginDevotee.innerHTML = empty + options;

  // ✅ OTHER DROPDOWNS
  els.assignDevotee.innerHTML = empty + options;

  const currentResetValue = els.resetDevotee.value;
  els.resetDevotee.innerHTML = empty + options;

  if (state.devotees.some((devotee) => devotee.id === currentResetValue)) {
    els.resetDevotee.value = currentResetValue;
  }

  const currentEntryValue = els.entryDevotee.value;
  els.entryDevotee.innerHTML = empty + options;

  if (session?.role === "devotee") {
    els.entryDevotee.value = session.devoteeId;
  } else if (state.devotees.some((devotee) => devotee.id === currentEntryValue)) {
    els.entryDevotee.value = currentEntryValue;
  } else if (state.devotees.length) {
    // ✅ FIRST ELEMENT WILL NOW BE A–Z FIRST NAME
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
  const isDevotee = session?.role === "devotee";
  const activeDevotee = isDevotee ? state.devotees.find((devotee) => devotee.id === session.devoteeId) : null;

  els.userBadge.textContent = isAdmin ? "Admin" : activeDevotee ? `Devotee: ${activeDevotee.name}` : "";
  els.csvBtn.classList.toggle("hidden", !isAdmin);
  els.exportBtn.classList.toggle("hidden", !isAdmin);
  els.importFile.closest(".file-label").classList.toggle("hidden", !isAdmin);
  els.entryDevotee.disabled = isDevotee;
  els.entryStatus.classList.toggle("hidden", isDevotee);
  if (isDevotee) els.entryStatus.value = "all";

  document.querySelector('[data-view="allCouponsView"]').classList.toggle("hidden", !isAdmin);
  document.querySelectorAll("[data-admin-tab]").forEach((tab) => tab.classList.toggle("hidden", !isAdmin));

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
  const money = state.coupons.reduce((sum, coupon) => sum + amountValue(coupon.amount), 0);

  els.totalCoupons.textContent = couponTotal().toLocaleString("en-IN");
  els.assignedCoupons.textContent = assigned.toLocaleString("en-IN");
  els.soldCoupons.textContent = sold.toLocaleString("en-IN");
  els.moneyReceived.textContent = formatMoney(money);
  els.settledCoupons.textContent = settled.toLocaleString("en-IN");
}

function renderDevotees() {
  // 🔒 Prevent devotees from seeing admin dashboard
if (session?.role === "devotee") {
  if (els.devoteeList) els.devoteeList.innerHTML = "";
  return;
}
  const query = els.devoteeSearch.value.trim().toLowerCase();
  const period = settlementPeriod();
  const devotees = state.devotees.filter((devotee) => {
    return `${devotee.name} ${devotee.contact}`.toLowerCase().includes(query);
  });

  const periodTotal = state.coupons
    .filter((coupon) => coupon.settled && inSettlementPeriod(coupon, period))
    .reduce((sum, coupon) => sum + amountValue(coupon.amount), 0);
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
      <article class="devotee-row">
        <div>
            <strong>
              ${escapeHtml(devotee.name)}
              <span class="small-stat">(PIN: ${devotee.pin ? escapeHtml(devotee.pin) : "Not set"})</span>
            </strong>
            
            <span class="small-stat">${escapeHtml(devotee.contact || "No contact number")}</span>
          <div>${ranges.map((range) => `<span class="coupon-pill">${range}</span>`).join("") || '<span class="small-stat">No coupons assigned</span>'}</div>
        </div>
        <span><strong>${summary.issued}</strong><span class="small-stat"> issued</span></span>
        <span><strong>${summary.sold}</strong><span class="small-stat"> sold</span></span>
        <span><strong>${summary.left}</strong><span class="small-stat"> left</span></span>
        <span><strong>${formatMoney(summary.settledAmount)}</strong><span class="small-stat"> settled</span></span>
        <span><strong>${formatMoney(summary.pendingAmount)}</strong><span class="small-stat"> pending</span></span>
        <span><strong>${formatMoney(summary.periodSettledAmount)}</strong><span class="small-stat"> ${escapeHtml(period.shortLabel)}</span></span>
        <button class="ghost" type="button" data-set-password="${escapeAttr(devotee.id)}">Set Password</button>
        <button class="ghost" type="button" data-send-whatsapp="${escapeAttr(devotee.id)}">
          WhatsApp
        </button>
        <button class="ghost" type="button" data-update-contact="${escapeAttr(devotee.id)}">
          Update Contact
        </button>
        <button class="danger" data-delete-devotee="${escapeAttr(devotee.id)}">
          Delete
        </button>
        <button class="ghost" type="button" data-open-devotee="${escapeAttr(devotee.id)}">Open</button>
      </article>
    `;
  }).join("");

  els.devoteeList.querySelectorAll("[data-open-devotee]").forEach((button) => {
    button.addEventListener("click", () => {
      els.entryDevotee.value = button.dataset.openDevotee;
      document.querySelector('[data-view="devoteeView"]').click();
    });
  });

  els.devoteeList.querySelectorAll("[data-set-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const devotee = state.devotees.find((item) => item.id === button.dataset.setPassword);
      if (!devotee) return;
      const password = window.prompt(`Enter new password for ${devotee.name}`);
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
  els.devoteeList.querySelectorAll("[data-send-whatsapp]").forEach(btn => {
  btn.addEventListener("click", () => {

    const devotee = state.devotees.find(d => d.id === btn.dataset.sendWhatsapp);
    if (!devotee) return;

    const period = settlementPeriod();
    const summary = devoteeSummary(devotee.id, period);
    const assigned = couponsForDevotee(devotee.id).length;

    // ✅ YOUR MESSAGE (customized)
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

    const phone = (devotee.contact || "").replace(/\D/g, "");

    if (!phone) {
      showToast("No contact number for this devotee");
      return;
    }

    const url = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;

    window.open(url, "_blank");
  });
});
  els.devoteeList.querySelectorAll("[data-update-contact]").forEach(btn => {
  btn.addEventListener("click", () => {

    const devotee = state.devotees.find(d => d.id === btn.dataset.updateContact);
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
els.devoteeList.querySelectorAll("[data-delete-devotee]").forEach(btn => {
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

  els.entryList.innerHTML = `
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
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

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
          <span class="status ${isSold(coupon) ? "sold" : "pending"}">${isSold(coupon) ? "Sold" : "Pending"}</span>
          <span class="status ${coupon.settled ? "settled" : "pending"}">${coupon.settled ? "Settled" : "Not Settled"}</span>
        </div>
        <div class="coupon-fields">
          <label>
            Buyer Name
            <input data-field="buyerName" value="${escapeAttr(coupon.buyerName)}" placeholder="Name" ${locked}>
          </label>
          <label>
            Contact Number
            <input data-field="buyerContact" value="${escapeAttr(coupon.buyerContact)}" placeholder="Phone" ${locked}>
          </label>
          <label>
            Amount Received
            <input data-field="amount" type="number" min="0" step="1" value="${escapeAttr(coupon.amount)}" placeholder="0" ${locked}>
          </label>
          <label>
            Assigned To
            <input value="${escapeAttr(devoteeName(coupon.devoteeId))}" disabled>
          </label>
     <!--     <label>
            Receipt Number
            <input data-field="receiptNumber" value="${escapeAttr(coupon.receiptNumber)}" placeholder="Receipt No" ${locked}>
      -->    </label>
          <label class="wide">
            Description / Purpose
            <label class="wide">
              Seva Type
              <select data-field="description" ${locked}>
                <option value="">Select Seva</option>
                <option value="Deepa Seva" ${coupon.description==="Deepa Seva"?"selected":""}>Deepa Seva</option>
                <option value="Chenetha Seva" ${coupon.description==="Chenetha Seva"?"selected":""}>Chenetha Seva</option>
                <option value="Sumangala Subhadram" ${coupon.description==="Sumangala Subhadram"?"selected":""}>Sumangala Subhadram</option>
                <option value="Panchopachara Seva" ${coupon.description==="Panchopachara Seva"?"selected":""}>Panchopachara Seva</option>
                <option value="General Donation" ${coupon.description==="General Donation"?"selected":""}>General Donation</option>
                <option value="Prasadam Donation" ${coupon.description==="Prasadam Donation"?"selected":""}>Prasadam Donation</option>
                <option value="Donation in Kind" ${coupon.description==="Donation in Kind"?"selected":""}>Donation in Kind</option>
              </select>
</label>
          </label>
        </div>
      </article>
    `;
  }).join("");

  els.entryList.querySelectorAll("[data-field]").forEach((field) => {
    field.addEventListener("change", updateCouponField);
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
  if (query) coupons = coupons.filter((coupon) => couponSearchText(coupon).includes(query));

  els.allCouponsBody.innerHTML = coupons.map((coupon) => `
    <tr>
      <td>#${coupon.number}</td>
      <td>${escapeHtml(devoteeName(coupon.devoteeId) || "-")}</td>
      <td>${escapeHtml(coupon.assignedAt || "-")}</td>
      <td>${escapeHtml(coupon.buyerName || "-")}</td>
      <td>${escapeHtml(coupon.buyerContact || "-")}</td>
      <td>${coupon.amount ? escapeHtml(formatMoney(amountValue(coupon.amount))) : "-"}</td>
      <td>${escapeHtml(coupon.receiptNumber || "-")}</td>
      <td>
        <button class="ghost settlement-btn" type="button" data-settlement="${coupon.number}">
          ${coupon.settled ? "Settled" : "Mark Settled"}
        </button>
      </td>
      <td>${escapeHtml(coupon.settledAt || "-")}</td>
      <td>${escapeHtml(coupon.description || "-")}</td>
    </tr>
  `).join("");

  els.allCouponsBody.querySelectorAll("[data-settlement]").forEach((button) => {
    button.addEventListener("click", toggleSettlement);
  });
}

function toggleSettlement(event) {
  if (session?.role !== "admin") {
    showToast("Only admin can update settlement");
    return;
  }

  const coupon = state.coupons[Number(event.currentTarget.dataset.settlement) - 1];
  coupon.settled = !coupon.settled;
  coupon.settledAt = coupon.settled ? todayKey() : "";
  saveState();
  render();
  showToast(coupon.settled ? `Coupon ${coupon.number} settled` : `Coupon ${coupon.number} marked pending`);
}

function updateCouponField(event) {
  const card = event.target.closest("[data-coupon-number]");
  const coupon = state.coupons[Number(card.dataset.couponNumber) - 1];
  if (session?.role === "devotee" && coupon.devoteeId !== session.devoteeId) {
    showToast("This coupon is not assigned to this devotee");
    return;
  }
  coupon[event.target.dataset.field] = event.target.value.trimStart();
  saveState();
  renderStats();
  renderDevotees();

  const status = card.querySelector(".status");
  status.textContent = isSold(coupon) ? "Sold" : "Pending";
  status.className = `status ${isSold(coupon) ? "sold" : "pending"}`;
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
    settled: false,
    settledAt: ""
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
      settled: Boolean(savedCoupon.settled),
      settledAt: savedCoupon.settledAt || ""
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
    <article><span>Amount Settled</span><strong>${formatMoney(summary.settledAmount)}</strong></article>
    <article><span>Amount Pending</span><strong>${formatMoney(summary.pendingAmount)}</strong></article>
    <article><span>Settled Coupons</span><strong>${summary.settledCount}</strong></article>
  `;
}

function devoteeSummary(devoteeId, period = settlementPeriod()) {
  const assigned = couponsForDevotee(devoteeId);
  const sold = assigned.filter(isSold);
  const settled = sold.filter((coupon) => coupon.settled);
  const pending = sold.filter((coupon) => !coupon.settled);
  const periodSettled = settled.filter((coupon) => inSettlementPeriod(coupon, period));

  return {
    issued: assigned.length,
    sold: sold.length,
    left: assigned.length - sold.length,
    settledCount: settled.length,
    pendingCount: pending.length,
    amountReceived: sold.reduce((sum, coupon) => sum + amountValue(coupon.amount), 0),
    settledAmount: settled.reduce((sum, coupon) => sum + amountValue(coupon.amount), 0),
    pendingAmount: pending.reduce((sum, coupon) => sum + amountValue(coupon.amount), 0),
    periodSettledAmount: periodSettled.reduce((sum, coupon) => sum + amountValue(coupon.amount), 0)
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

  for (let index = 1; index <= sorted.length; index += 1) {
    const number = sorted[index];
    if (number === prev + 1) {
      prev = number;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = number;
    prev = number;
  }

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
  const headers = ["Coupon", "Assigned To", "Assigned Date", "Devotee Contact", "Buyer Name", "Buyer Contact", "Amount", "Settlement", "Settlement Date", "Description"];
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
      coupon.description
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
        totalCoupons: positiveInteger(imported.settings?.totalCoupons) || imported.coupons.length || DEFAULT_TOTAL_COUPONS
      };
      state.devotees = imported.devotees.map(normalizeDevotee);
      state.coupons = normalizeCoupons(imported.coupons, state.settings.totalCoupons);

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
// ================= FIREBASE SYNC (ADD ONLY THIS) =================

let firebaseReady = false;
let dbRef = null;

function updateSyncBadge(text) {
  const badge = document.getElementById("syncBadge");
  if (badge) badge.textContent = text;
}

function applyFirebaseData(data) {
  if (data.settings) state.settings = data.settings;
  if (Array.isArray(data.devotees)) state.devotees = data.devotees.map(normalizeDevotee);
  if (Array.isArray(data.coupons)) state.coupons = normalizeCoupons(data.coupons, couponTotal());

  originalSaveState();
   // ✅ IMPORTANT FIX
  renderSelectors();   // 🔥 force sorted dropdown refresh
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

function initFirebaseSync() {
  try {
    // Check Firebase availability
    if (!window.firebase || !window.COUPON_TRACKER_FIREBASE?.config?.databaseURL) {
      updateSyncBadge("Local");
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
        
          // 🚫 Don't re-render while typing
          if (isEditing && document.hasFocus()) {
            pendingFirebaseData = snapshot.val();
            return;
          }
        
          const data = snapshot.val();
        
          applyFirebaseData(data);
        });

        updateSyncBadge("Realtime");

        // First-time push if DB empty
        dbRef.once("value").then((snap) => {
          if (!snap.exists()) {
            dbRef.set(state);
          }
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

// 🔥 Override saveState (no logic change)
const originalSaveState = saveState;

saveState = function () {
  originalSaveState();

  if (firebaseReady && dbRef) {
    dbRef.set(state);
  }
};
