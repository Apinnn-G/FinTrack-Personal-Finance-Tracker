/**
 * FinTrack – Personal Finance Tracker
 * script.js — Main application logic
 *
 * Features:
 *  - CRUD transactions (Create, Read, Update, Delete)
 *  - Transaction notes (optional per-transaction description)
 *  - LocalStorage persistence
 *  - Filter by type: all / income / expense  (with live count badges)
 *  - Period filter: all time / this month / last month / this year / custom range
 *  - Sort: date, amount, name (asc / desc)
 *  - Search by name (live, case-insensitive)
 *  - Summary cards auto-update (balance, income, expense)
 *  - Category breakdown bar chart (top expense categories)
 *  - Export visible transactions to CSV
 *  - Toast notifications (success / info / warning / error)
 *  - Input validation
 *  - Delete confirmation modal
 */

'use strict';

/* =============================================
   CONSTANTS & STATE
   ============================================= */

const STORAGE_KEY = 'fintrack_transactions';

/** @type {Transaction[]} In-memory list of all transactions */
let transactions = [];

/**
 * @typedef {Object} Transaction
 * @property {string} id         - Unique identifier
 * @property {string} name       - Transaction name/description
 * @property {number} amount     - Positive numeric amount
 * @property {string} category   - Category label
 * @property {'income'|'expense'} type - Transaction type
 * @property {string} date       - ISO date string (YYYY-MM-DD)
 * @property {string} notes      - Optional free-text notes
 */

/** Currently active type filter: 'all' | 'income' | 'expense' */
let activeFilter = 'all';

/** Currently active period: 'all' | 'this-month' | 'last-month' | 'this-year' | 'custom' */
let activePeriod = 'all';

/** Current sort key: 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'name-asc' | 'name-desc' */
let activeSort = 'date-desc';

/** Current search query */
let searchQuery = '';

/** ID of the transaction being edited (null when adding) */
let editingId = null;

/** ID of the transaction pending deletion */
let deletingId = null;

/* =============================================
   DOM REFERENCES
   ============================================= */

const totalBalanceEl  = document.getElementById('total-balance');
const totalIncomeEl   = document.getElementById('total-income');
const totalExpenseEl  = document.getElementById('total-expense');
const transactionList = document.getElementById('transaction-list');
const emptyState      = document.getElementById('empty-state');
const searchInput     = document.getElementById('search-input');
const sortSelect      = document.getElementById('sort-select');
const currentDateEl   = document.getElementById('current-date');
const footerYearEl    = document.getElementById('footer-year');
const txCountBadge    = document.getElementById('tx-count-badge');
const chartSection    = document.getElementById('chart-section');
const categoryChart   = document.getElementById('category-chart');
const chartPeriodLabel= document.getElementById('chart-period-label');
const toastContainer  = document.getElementById('toast-container');
const rangeFrom       = document.getElementById('range-from');
const rangeTo         = document.getElementById('range-to');
const customRange     = document.getElementById('custom-range');

// Modal: Add / Edit
const modalOverlay    = document.getElementById('modal-overlay');
const modalTitle      = document.getElementById('modal-title');
const transactionForm = document.getElementById('transaction-form');
const editIdInput     = document.getElementById('edit-id');
const inputName       = document.getElementById('input-name');
const inputAmount     = document.getElementById('input-amount');
const inputCategory   = document.getElementById('input-category');
const inputType       = document.getElementById('input-type');
const inputDate       = document.getElementById('input-date');
const inputNotes      = document.getElementById('input-notes');

// Modal: Confirm Delete
const confirmOverlay  = document.getElementById('confirm-overlay');
const confirmNameEl   = document.getElementById('confirm-name');

/* =============================================
   LOCALSTORAGE HELPERS
   ============================================= */

/** Load transactions from LocalStorage into memory */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    transactions = raw ? JSON.parse(raw) : [];
    // Ensure legacy data without 'notes' still works
    transactions.forEach(t => { if (t.notes === undefined) t.notes = ''; });
  } catch {
    transactions = [];
  }
}

/** Persist the current transactions array to LocalStorage */
function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

/* =============================================
   FORMATTING UTILITIES
   ============================================= */

/**
 * Format a number as Indonesian Rupiah.
 * @param {number} amount
 * @returns {string}  e.g. "Rp 1.500.000"
 */
function formatRupiah(amount) {
  return 'Rp ' + Math.abs(amount).toLocaleString('id-ID');
}

/**
 * Format ISO date string to human-readable Indonesian form.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string}  e.g. "31 Okt 2026"
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const [y, m, d] = dateStr.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Generate a unique ID */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Return today's date as YYYY-MM-DD */
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get first and last day of a given month as YYYY-MM-DD strings.
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {{ from: string, to: string }}
 */
function monthRange(year, month) {
  const from = new Date(year, month, 1);
  const to   = new Date(year, month + 1, 0);
  return {
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
  };
}

/* =============================================
   PERIOD FILTER HELPERS
   ============================================= */

/**
 * Get the active date range as { from, to } strings (YYYY-MM-DD) or null for "all time".
 * @returns {{ from: string, to: string } | null}
 */
function getActiveDateRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (activePeriod) {
    case 'this-month':
      return monthRange(y, m);
    case 'last-month': {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return monthRange(ly, lm);
    }
    case 'this-year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'custom': {
      const f = rangeFrom.value;
      const t = rangeTo.value;
      if (f && t && f <= t) return { from: f, to: t };
      return null; // invalid custom range → show all
    }
    default:
      return null; // 'all'
  }
}

/**
 * Human-readable label for the current active period (used in chart header).
 * @returns {string}
 */
function getPeriodLabel() {
  const now = new Date();
  switch (activePeriod) {
    case 'this-month':
      return now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    case 'last-month': {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    }
    case 'this-year':
      return String(now.getFullYear());
    case 'custom': {
      const f = rangeFrom.value;
      const t = rangeTo.value;
      return (f && t) ? `${formatDate(f)} – ${formatDate(t)}` : 'Custom Range';
    }
    default:
      return 'All Time';
  }
}

/* =============================================
   FILTERING & SORTING ENGINE
   ============================================= */

/**
 * Apply all active filters (type, period, search) and sort to produce
 * the final visible list of transactions.
 * @returns {Transaction[]}
 */
function getFilteredTransactions() {
  const dateRange = getActiveDateRange();

  let result = transactions.filter(t => {
    // Type filter
    if (activeFilter === 'income'  && t.type !== 'income')  return false;
    if (activeFilter === 'expense' && t.type !== 'expense') return false;

    // Period filter
    if (dateRange) {
      if (t.date < dateRange.from || t.date > dateRange.to) return false;
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (!t.name.toLowerCase().includes(q) &&
          !t.category.toLowerCase().includes(q)) return false;
    }

    return true;
  });

  // Sort
  result.sort((a, b) => {
    switch (activeSort) {
      case 'date-asc':    return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
      case 'amount-desc': return b.amount - a.amount;
      case 'amount-asc':  return a.amount - b.amount;
      case 'name-asc':    return a.name.localeCompare(b.name, 'id');
      case 'name-desc':   return b.name.localeCompare(a.name, 'id');
      default: /* date-desc */ return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
    }
  });

  return result;
}

/* =============================================
   SUMMARY CARDS
   ============================================= */

/**
 * Recalculate totals from ALL transactions (not filtered) and update the cards.
 * The summary always reflects global totals regardless of filters.
 */
function updateSummary() {
  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);

  const totalExpense = transactions
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const balance = totalIncome - totalExpense;

  totalBalanceEl.textContent = formatRupiah(balance);
  totalIncomeEl.textContent  = formatRupiah(totalIncome);
  totalExpenseEl.textContent = formatRupiah(totalExpense);

  // Colour the balance red when negative
  totalBalanceEl.style.color = balance < 0 ? '#fca5a5' : '';
}

/* =============================================
   FILTER COUNT BADGES
   ============================================= */

/** Update the count badges on the type filter buttons. */
function updateFilterCounts() {
  const dateRange = getActiveDateRange();

  // Count in-period transactions per type
  const inPeriod = transactions.filter(t => {
    if (!dateRange) return true;
    return t.date >= dateRange.from && t.date <= dateRange.to;
  });

  const allCount     = inPeriod.length;
  const incomeCount  = inPeriod.filter(t => t.type === 'income').length;
  const expenseCount = inPeriod.filter(t => t.type === 'expense').length;

  const setCount = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val > 0 ? val : '';
  };

  setCount('count-all',     allCount);
  setCount('count-income',  incomeCount);
  setCount('count-expense', expenseCount);
}

/* =============================================
   CATEGORY BREAKDOWN CHART
   ============================================= */

/**
 * Render the expense-by-category horizontal bar chart.
 * Only considers expense transactions in the currently active period.
 */
function renderCategoryChart() {
  const dateRange = getActiveDateRange();

  // Aggregate expense amounts per category (within active period)
  const totals = {};
  transactions.forEach(t => {
    if (t.type !== 'expense') return;
    if (dateRange && (t.date < dateRange.from || t.date > dateRange.to)) return;
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });

  const entries = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6); // top 6 categories

  if (entries.length === 0) {
    chartSection.classList.add('hidden');
    return;
  }

  chartSection.classList.remove('hidden');
  chartPeriodLabel.textContent = getPeriodLabel();

  const max = entries[0][1];

  // Category colours (cycling palette)
  const colours = ['#ef4444','#f97316','#eab308','#8b5cf6','#06b6d4','#ec4899'];

  categoryChart.innerHTML = entries.map(([cat, amt], i) => {
    const pct = max > 0 ? (amt / max) * 100 : 0;
    return `
      <div class="chart-bar-row">
        <span class="chart-bar-label" title="${escapeHTML(cat)}">${escapeHTML(cat)}</span>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width:${pct.toFixed(1)}%;background-color:${colours[i % colours.length]}"></div>
        </div>
        <span class="chart-bar-value">${formatRupiah(amt)}</span>
      </div>`;
  }).join('');
}

/* =============================================
   TRANSACTION LIST RENDERING
   ============================================= */

/**
 * Build the HTML for a single transaction item.
 * @param {Transaction} t
 * @returns {string} HTML string
 */
function buildTransactionHTML(t) {
  const isIncome  = t.type === 'income';
  const typeClass = isIncome ? 'income' : 'expense';
  const sign      = isIncome ? '+' : '−';

  const iconSVG = isIncome
    ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12"/>
       </svg>`
    : `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 13l-5 5m0 0l-5-5m5 5V6"/>
       </svg>`;

  const noteHTML = t.notes
    ? `<p class="transaction-note" title="${escapeHTML(t.notes)}">📝 ${escapeHTML(t.notes)}</p>`
    : '';

  return `
    <div class="transaction-item" data-id="${t.id}">
      <div class="transaction-icon ${typeClass}" aria-hidden="true">${iconSVG}</div>

      <div class="flex-1 min-w-0">
        <p class="transaction-name" title="${escapeHTML(t.name)}">${escapeHTML(t.name)}</p>
        <p class="transaction-meta">
          <span class="category-badge">${escapeHTML(t.category)}</span>
          <span>${formatDate(t.date)}</span>
        </p>
        ${noteHTML}
      </div>

      <div class="text-right flex-shrink-0 mr-2 mt-0.5">
        <p class="transaction-amount ${typeClass} text-base">${sign} ${formatRupiah(t.amount)}</p>
      </div>

      <div class="flex items-center gap-1 flex-shrink-0 mt-0.5">
        <button class="btn-action btn-edit"   data-id="${t.id}" aria-label="Edit ${escapeHTML(t.name)}"   title="Edit">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                 m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
        </button>
        <button class="btn-action btn-delete" data-id="${t.id}" aria-label="Delete ${escapeHTML(t.name)}" title="Delete">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7
                 m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-9 0h14"/>
          </svg>
        </button>
      </div>
    </div>`;
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Re-render the transaction list based on all active filters, period, sort and search. */
function renderTransactions() {
  const filtered = getFilteredTransactions();

  // Update count badge above the list
  if (filtered.length > 0) {
    txCountBadge.textContent = `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`;
    txCountBadge.classList.remove('hidden');
  } else {
    txCountBadge.classList.add('hidden');
  }

  if (filtered.length === 0) {
    transactionList.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.classList.add('flex');
  } else {
    emptyState.classList.add('hidden');
    emptyState.classList.remove('flex');
    transactionList.innerHTML = filtered.map(buildTransactionHTML).join('');
  }

  // Also refresh the filter count badges and chart whenever list updates
  updateFilterCounts();
  renderCategoryChart();
}

/* =============================================
   TOAST NOTIFICATIONS
   ============================================= */

/**
 * Show a toast message.
 * @param {string} message
 * @param {'success'|'info'|'warning'|'error'} [type='success']
 * @param {number} [duration=3000] - auto-dismiss after ms
 */
function showToast(message, type = 'success', duration = 3000) {
  const icons = {
    success: `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`,
    info:    `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
    warning: `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`,
    error:   `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`,
  };

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icons[type] || ''}<span>${escapeHTML(message)}</span>`;
  toastContainer.appendChild(el);

  // Auto-dismiss
  setTimeout(() => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

/* =============================================
   EXPORT CSV
   ============================================= */

/** Download the currently-visible (filtered) transactions as a CSV file. */
function exportCSV() {
  const filtered = getFilteredTransactions();

  if (filtered.length === 0) {
    showToast('No transactions to export.', 'warning');
    return;
  }

  const headers = ['Name', 'Type', 'Category', 'Amount (Rp)', 'Date', 'Notes'];
  const rows = filtered.map(t => [
    `"${t.name.replace(/"/g, '""')}"`,
    t.type,
    t.category,
    t.amount,
    t.date,
    `"${(t.notes || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href     = url;
  a.download = `fintrack-transactions-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Exported ${filtered.length} transaction${filtered.length !== 1 ? 's' : ''} to CSV.`, 'info');
}

/* =============================================
   MODAL: ADD / EDIT
   ============================================= */

/** Re-trigger the CSS entry animation on the modal box. */
function triggerModalAnimation() {
  const box = document.getElementById('modal-box');
  box.classList.remove('modal-enter');
  void box.offsetWidth; // force reflow
  box.classList.add('modal-enter');
}

/** Open the transaction form modal (add mode). */
function openAddModal() {
  editingId = null;
  editIdInput.value = '';
  transactionForm.reset();
  clearFormErrors();
  modalTitle.textContent = 'Add Transaction';
  inputDate.value = todayISO();
  modalOverlay.classList.remove('hidden');
  triggerModalAnimation();
  inputName.focus();
}

/**
 * Open the transaction form modal in edit mode.
 * @param {string} id - Transaction ID to edit
 */
function openEditModal(id) {
  const t = transactions.find(t => t.id === id);
  if (!t) return;

  editingId = id;
  editIdInput.value   = id;
  modalTitle.textContent = 'Edit Transaction';
  inputName.value     = t.name;
  inputAmount.value   = t.amount;
  inputCategory.value = t.category;
  inputType.value     = t.type;
  inputDate.value     = t.date;
  inputNotes.value    = t.notes || '';

  clearFormErrors();
  modalOverlay.classList.remove('hidden');
  triggerModalAnimation();
  inputName.focus();
}

/** Close the transaction form modal. */
function closeModal() {
  modalOverlay.classList.add('hidden');
  transactionForm.reset();
  clearFormErrors();
  editingId = null;
}

/* =============================================
   FORM VALIDATION
   ============================================= */

/**
 * Validate all required form fields.
 * @returns {boolean} true if all fields are valid
 */
function validateForm() {
  let valid = true;
  clearFormErrors();

  if (!inputName.value.trim()) {
    showError('error-name', 'input-name');
    valid = false;
  }

  const amt = parseFloat(inputAmount.value);
  if (!inputAmount.value || isNaN(amt) || amt <= 0) {
    showError('error-amount', 'input-amount');
    valid = false;
  }

  if (!inputCategory.value) {
    showError('error-category', 'input-category');
    valid = false;
  }

  if (!inputType.value) {
    showError('error-type', 'input-type');
    valid = false;
  }

  if (!inputDate.value) {
    showError('error-date', 'input-date');
    valid = false;
  }

  return valid;
}

/**
 * Show a validation error for a specific field.
 * @param {string} errorId
 * @param {string} inputId
 */
function showError(errorId, inputId) {
  document.getElementById(errorId).classList.remove('hidden');
  document.getElementById(inputId).classList.add('input-error');
}

/** Clear all validation error states. */
function clearFormErrors() {
  ['error-name','error-amount','error-category','error-type','error-date'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  ['input-name','input-amount','input-category','input-type','input-date'].forEach(id => {
    document.getElementById(id).classList.remove('input-error');
  });
}

/* =============================================
   CRUD OPERATIONS
   ============================================= */

/** @param {Omit<Transaction,'id'>} data */
function addTransaction(data) {
  transactions.unshift({ id: generateId(), ...data });
  saveToStorage();
  updateSummary();
  renderTransactions();
  showToast(`"${data.name}" added successfully.`, 'success');
}

/**
 * @param {string} id
 * @param {Omit<Transaction,'id'>} data
 */
function updateTransaction(id, data) {
  const idx = transactions.findIndex(t => t.id === id);
  if (idx === -1) return;
  transactions[idx] = { id, ...data };
  saveToStorage();
  updateSummary();
  renderTransactions();
  showToast(`"${data.name}" updated.`, 'info');
}

/** @param {string} id */
function deleteTransaction(id) {
  const t = transactions.find(t => t.id === id);
  const name = t ? t.name : 'Transaction';
  transactions = transactions.filter(t => t.id !== id);
  saveToStorage();
  updateSummary();
  renderTransactions();
  showToast(`"${name}" deleted.`, 'error');
}

/* =============================================
   CONFIRM DELETE MODAL
   ============================================= */

/** @param {string} id */
function openConfirmModal(id) {
  const t = transactions.find(t => t.id === id);
  if (!t) return;
  deletingId = id;
  confirmNameEl.textContent = t.name;
  confirmOverlay.classList.remove('hidden');
}

function closeConfirmModal() {
  confirmOverlay.classList.add('hidden');
  deletingId = null;
}

/* =============================================
   EVENT LISTENERS
   ============================================= */

// Form submit — add or update
transactionForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (!validateForm()) return;

  const data = {
    name:     inputName.value.trim(),
    amount:   parseFloat(inputAmount.value),
    category: inputCategory.value,
    type:     inputType.value,
    date:     inputDate.value,
    notes:    inputNotes.value.trim(),
  };

  if (editingId) {
    updateTransaction(editingId, data);
  } else {
    addTransaction(data);
  }
  closeModal();
});

// Add / close modal buttons
document.getElementById('btn-add-transaction').addEventListener('click', openAddModal);
document.getElementById('btn-close-modal').addEventListener('click', closeModal);
document.getElementById('btn-cancel-form').addEventListener('click', closeModal);

// Export CSV
document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

// Modal backdrop click
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// Delete confirmation buttons
document.getElementById('btn-confirm-delete').addEventListener('click', function () {
  if (deletingId) deleteTransaction(deletingId);
  closeConfirmModal();
});
document.getElementById('btn-cancel-delete').addEventListener('click', closeConfirmModal);
confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) closeConfirmModal(); });

// Escape key
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (!modalOverlay.classList.contains('hidden'))   closeModal();
    if (!confirmOverlay.classList.contains('hidden')) closeConfirmModal();
  }
});

// Delegated edit / delete buttons inside the list
transactionList.addEventListener('click', function (e) {
  const editBtn   = e.target.closest('.btn-edit');
  const deleteBtn = e.target.closest('.btn-delete');
  if (editBtn)   openEditModal(editBtn.dataset.id);
  else if (deleteBtn) openConfirmModal(deleteBtn.dataset.id);
});

// Type filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-filter'));
    this.classList.add('active-filter');
    activeFilter = this.dataset.filter;
    renderTransactions();
  });
});

// Period filter buttons
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active-period'));
    this.classList.add('active-period');
    activePeriod = this.dataset.period;
    // Show/hide custom date range inputs
    customRange.classList.toggle('hidden', activePeriod !== 'custom');
    customRange.classList.toggle('flex',   activePeriod === 'custom');
    renderTransactions();
  });
});

// Custom date range inputs
rangeFrom.addEventListener('change', () => { if (activePeriod === 'custom') renderTransactions(); });
rangeTo.addEventListener('change',   () => { if (activePeriod === 'custom') renderTransactions(); });

// Sort select
sortSelect.addEventListener('change', function () {
  activeSort = this.value;
  renderTransactions();
});

// Search input — live filter
searchInput.addEventListener('input', function () {
  searchQuery = this.value;
  renderTransactions();
});

// Clear input-error on user interaction
[inputName, inputAmount, inputCategory, inputType, inputDate].forEach(el => {
  el.addEventListener('input',  () => el.classList.remove('input-error'));
  el.addEventListener('change', () => el.classList.remove('input-error'));
});

/* =============================================
   INITIALISATION
   ============================================= */

function init() {
  // Display current date
  if (currentDateEl) {
    currentDateEl.textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  // Footer year
  if (footerYearEl) {
    footerYearEl.textContent = new Date().getFullYear();
  }

  // Load & render
  loadFromStorage();
  updateSummary();
  renderTransactions();
}

document.addEventListener('DOMContentLoaded', init);
