/* ==========================================================================
   Quotation & Invoice Builder — application logic
   Local-first, no build step, no dependencies besides vendor/html2canvas.js
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------- utilities */

  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function uid() {
    return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function addDaysISO(iso, days) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], obj);
    target[last] = value;
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function genNumber(prefix) {
    const d = new Date();
    return `${prefix}-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-01`;
  }

  /* ---------------------------------------------------------- constants */

  const STORAGE_DRAFT = "qib.currentDraft";
  const STORAGE_SAVED = "qib.savedDocs";
  const STORAGE_CREATOR = "qib.creatorDefaults";

  const DEFAULT_CREATOR = {
    name: "Abdul Fariz",
    title: "Motion Designer & 3D Artist",
    specialization: "Product CGI · SaaS Motion · Hybrid Commercials",
    email: "alfarizgraphic@gmail.com",
    phone: "+62 857-7607-9212",
    website: "",
  };

  const CURRENCY_SYMBOLS = { IDR: "Rp", USD: "$", SGD: "S$" };

  const PRESETS = {
    motion: ["Creative / Visual Development", "Motion Design", "Compositing", "Final Delivery"],
    cgi: ["Look Development", "3D Production", "Animation / Rendering", "Compositing", "Final Delivery"],
    ai: ["Visual Development", "AI-Assisted Production", "Motion / Compositing", "Final Delivery"],
    liveaction: ["Pre-production", "Production / Shooting", "Post-production", "Final Delivery"],
    full: ["Pre-production", "Production", "Post-production", "Deliverables"],
  };

  const DEFAULT_TERMS = {
    revision: "Up to 2 rounds of minor revisions. Major changes to the approved scope or creative direction may require an additional fee.",
    exclusions: "Additional requirements outside the agreed scope will be quoted separately.",
    paymentTermsQuote: "50% deposit to begin production, 50% upon final delivery.",
    paymentTermsInvoice: "Payment due within 14 days of the invoice date.",
    notes: "",
  };

  /* ---------------------------------------------------------- state */

  function loadCreatorDefaults() {
    try {
      const raw = localStorage.getItem(STORAGE_CREATOR);
      if (raw) return Object.assign({}, DEFAULT_CREATOR, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return Object.assign({}, DEFAULT_CREATOR);
  }

  function saveCreatorDefaults(creator) {
    try { localStorage.setItem(STORAGE_CREATOR, JSON.stringify(creator)); } catch (e) { /* ignore */ }
  }

  function newServiceRow() {
    return { id: uid(), name: "", detail: "", qty: 1, unit: "", rate: 0, showQtyUnit: true, manualAmount: 0 };
  }

  function newPhase() {
    return { id: uid(), name: "", items: [newServiceRow()] };
  }

  // Pre-hierarchy drafts/saved docs stored a flat `services` array. Wrap it
  // into a single unnamed phase so old localStorage data keeps working.
  function migrateState(raw) {
    if (raw && !raw.phases) {
      raw.phases = [{ id: uid(), name: "", items: Array.isArray(raw.services) && raw.services.length ? raw.services : [newServiceRow()] }];
    }
    if (raw) delete raw.services;
    return raw;
  }

  function defaultState(type) {
    type = type === "invoice" ? "invoice" : "quotation";
    const today = todayISO();
    return {
      id: uid(),
      savedAt: null,
      type: type,
      autoNumber: true,
      meta: {
        number: genNumber(type === "quotation" ? "Q" : "INV"),
        date: today,
        validUntil: addDaysISO(today, 14),
        dueDate: addDaysISO(today, 14),
        poRef: "",
      },
      client: { name: "", address: "" },
      project: { name: "", description: "" },
      sections: {
        clientAddress: true,
        projectDescription: true,
        scope: true,
        revision: true,
        exclusions: true,
        paymentTerms: true,
        notes: true,
        paymentDetails: false,
        poRef: false,
        discount: false,
        additionalCost: false,
      },
      scopeItems: ["", ""],
      phases: [newPhase()],
      terms: {
        revision: DEFAULT_TERMS.revision,
        exclusions: DEFAULT_TERMS.exclusions,
        paymentTerms: type === "quotation" ? DEFAULT_TERMS.paymentTermsQuote : DEFAULT_TERMS.paymentTermsInvoice,
        notes: DEFAULT_TERMS.notes,
      },
      payment: { bankName: "", accountName: "", accountNumber: "" },
      currency: "IDR",
      customCurrencySymbol: "",
      calc: { discountType: "percent", discountValue: 0, additionalCostLabel: "", additionalCostValue: 0 },
      creator: loadCreatorDefaults(),
    };
  }

  let state = loadInitialState();
  let dirty = false;

  function loadInitialState() {
    try {
      const raw = localStorage.getItem(STORAGE_DRAFT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.meta && (parsed.services || parsed.phases)) return migrateState(parsed);
      }
    } catch (e) { /* ignore, fall through */ }
    return defaultState("quotation");
  }

  function loadSavedDocs() {
    try {
      const raw = localStorage.getItem(STORAGE_SAVED);
      const list = raw ? JSON.parse(raw) : [];
      return list.map(migrateState);
    } catch (e) { return []; }
  }
  function persistSavedDocs(list) {
    try { localStorage.setItem(STORAGE_SAVED, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------- currency */

  function formatInt(n, sep) {
    const sign = n < 0 ? "-" : "";
    return sign + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  function currencySymbol(st) {
    return st.currency === "custom" ? (st.customCurrencySymbol || "") : CURRENCY_SYMBOLS[st.currency];
  }

  function formatMoney(value, st) {
    const v = Number(value) || 0;
    const symbol = currencySymbol(st);
    if (st.currency === "IDR") return symbol + formatInt(v, ".");
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return symbol + sign + abs;
  }

  /* ---------------------------------------------------------- calculations */

  function rowAmount(row) {
    if (!row.showQtyUnit) return Number(row.manualAmount) || 0;
    return (Number(row.qty) || 0) * (Number(row.rate) || 0);
  }

  function computePhaseSubtotal(phase) {
    return phase.items.reduce((sum, r) => sum + rowAmount(r), 0);
  }

  function computeTotals(st) {
    const subtotal = st.phases.reduce((sum, phase) => sum + computePhaseSubtotal(phase), 0);
    let discountAmt = 0;
    if (st.sections.discount) {
      discountAmt = st.calc.discountType === "percent"
        ? subtotal * ((Number(st.calc.discountValue) || 0) / 100)
        : (Number(st.calc.discountValue) || 0);
    }
    let additionalAmt = 0;
    if (st.sections.additionalCost) additionalAmt = Number(st.calc.additionalCostValue) || 0;
    const total = subtotal - discountAmt + additionalAmt;
    return { subtotal, discountAmt, additionalAmt, total };
  }

  /* ---------------------------------------------------------- dirty / autosave */

  let autosaveTimer = null;
  function scheduleAutosave() {
    dirty = true;
    updateSaveStatus();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }, 250);
  }

  function updateSaveStatus() {
    const el = qs("#saveStatus");
    if (!el) return;
    el.textContent = dirty ? "Unsaved changes" : "All changes saved";
    el.classList.toggle("is-dirty", dirty);
  }

  function markClean() {
    dirty = false;
    updateSaveStatus();
  }

  /* ---------------------------------------------------------- render: controls */

  const FIELD_BINDINGS = [
    ["#fDocNumber", "meta.number", "text"],
    ["#fDocDate", "meta.date", "text"],
    ["#fValidUntil", "meta.validUntil", "text"],
    ["#fDueDate", "meta.dueDate", "text"],
    ["#fPoRef", "meta.poRef", "text"],
    ["#fClientName", "client.name", "text"],
    ["#fClientAddress", "client.address", "text"],
    ["#fProjectName", "project.name", "text"],
    ["#fProjectDesc", "project.description", "text"],
    ["#fRevision", "terms.revision", "text"],
    ["#fExclusions", "terms.exclusions", "text"],
    ["#fPaymentTerms", "terms.paymentTerms", "text"],
    ["#fNotes", "terms.notes", "text"],
    ["#fBankName", "payment.bankName", "text"],
    ["#fAccountName", "payment.accountName", "text"],
    ["#fAccountNumber", "payment.accountNumber", "text"],
    ["#fDiscountType", "calc.discountType", "text"],
    ["#fDiscountValue", "calc.discountValue", "number"],
    ["#fAdditionalCostLabel", "calc.additionalCostLabel", "text"],
    ["#fAdditionalCostValue", "calc.additionalCostValue", "number"],
    ["#fCurrency", "currency", "text"],
    ["#fCustomCurrency", "customCurrencySymbol", "text"],
    ["#fCreatorName", "creator.name", "text"],
    ["#fCreatorTitle", "creator.title", "text"],
    ["#fCreatorSpecialization", "creator.specialization", "text"],
    ["#fCreatorEmail", "creator.email", "text"],
    ["#fCreatorPhone", "creator.phone", "text"],
    ["#fCreatorWebsite", "creator.website", "text"],
  ];

  const TOGGLE_BINDINGS = [
    ["#tClientAddress", "sections.clientAddress"],
    ["#tProjectDesc", "sections.projectDescription"],
    ["#tScope", "sections.scope"],
    ["#tRevision", "sections.revision"],
    ["#tExclusions", "sections.exclusions"],
    ["#tPaymentTerms", "sections.paymentTerms"],
    ["#tPaymentDetails", "sections.paymentDetails"],
    ["#tPoRef", "sections.poRef"],
    ["#tNotes", "sections.notes"],
    ["#tDiscount", "sections.discount"],
    ["#tAdditionalCost", "sections.additionalCost"],
  ];

  function syncControlsFromState() {
    FIELD_BINDINGS.forEach(([sel, path]) => {
      const el = qs(sel);
      if (!el) return;
      el.value = getPath(state, path) == null ? "" : getPath(state, path);
    });
    TOGGLE_BINDINGS.forEach(([sel, path]) => {
      const el = qs(sel);
      if (!el) return;
      el.checked = !!getPath(state, path);
      applyOffState(el);
    });

    qsa("#docTypeToggle .segmented-opt").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.value === state.type);
    });
    applyTypeVisibility(state.type);

    qs("#wrapCustomCurrency").hidden = state.currency !== "custom";

    renderScopeList();
    renderPhasesList();
    renderDocument();
    updateSavedCount();
    updateSaveStatus();
  }

  function applyOffState(checkboxEl) {
    const group = checkboxEl.closest(".toggle-field") || checkboxEl.closest(".ctrl-group");
    if (group) group.classList.toggle("is-off", !checkboxEl.checked);
  }

  function applyTypeVisibility(type) {
    const isInvoice = type === "invoice";
    qs("#lblDocNumber").textContent = isInvoice ? "Invoice Number" : "Quotation Number";
    qs("#lblDocDate").textContent = isInvoice ? "Invoice Date" : "Date";
    qs("#wrapValidUntil").hidden = isInvoice;
    qs("#wrapDueDate").hidden = !isInvoice;
    qs("#wrapPoRef").hidden = !isInvoice;
    qs("#wrapPaymentDetails").hidden = !isInvoice;
  }

  function bindControlEvents() {
    FIELD_BINDINGS.forEach(([sel, path, kind]) => {
      const el = qs(sel);
      if (!el) return;
      el.addEventListener("input", () => {
        let val = el.value;
        if (kind === "number") val = val === "" ? 0 : Number(val);
        if (path === "meta.number") state.autoNumber = false;
        setPath(state, path, val);
        if (path === "currency") qs("#wrapCustomCurrency").hidden = val !== "custom";
        renderDocument();
        scheduleAutosave();
      });
    });

    TOGGLE_BINDINGS.forEach(([sel, path]) => {
      const el = qs(sel);
      if (!el) return;
      el.addEventListener("change", () => {
        setPath(state, path, el.checked);
        applyOffState(el);
        renderDocument();
        scheduleAutosave();
      });
    });

    qsa("#docTypeToggle .segmented-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        const newType = btn.dataset.value;
        if (newType === state.type) return;
        state.type = newType;
        if (state.autoNumber) state.meta.number = genNumber(newType === "quotation" ? "Q" : "INV");
        if (!state.terms.paymentTerms || state.terms.paymentTerms === DEFAULT_TERMS.paymentTermsQuote || state.terms.paymentTerms === DEFAULT_TERMS.paymentTermsInvoice) {
          state.terms.paymentTerms = newType === "quotation" ? DEFAULT_TERMS.paymentTermsQuote : DEFAULT_TERMS.paymentTermsInvoice;
        }
        syncControlsFromState();
        scheduleAutosave();
      });
    });

    qs("#fPreset").addEventListener("change", (e) => {
      const key = e.target.value;
      if (!key || !PRESETS[key]) return;
      const items = PRESETS[key].map((name) => {
        const row = newServiceRow();
        row.name = name;
        row.unit = "lump sum";
        return row;
      });
      const isBlankSinglePhase = state.phases.length === 1
        && !state.phases[0].name.trim()
        && state.phases[0].items.every((r) => r.name === "" && r.detail === "" && rowAmount(r) === 0);
      if (isBlankSinglePhase) {
        state.phases[0].items = items;
      } else {
        state.phases.push({ id: uid(), name: "", items });
      }
      e.target.value = "";
      renderPhasesList();
      renderDocument();
      scheduleAutosave();
      showToast("Preset added — edit rates as needed");
    });

    // creator identity edits also update the persistent default
    ["#fCreatorName", "#fCreatorTitle", "#fCreatorSpecialization", "#fCreatorEmail", "#fCreatorPhone", "#fCreatorWebsite"].forEach((sel) => {
      qs(sel).addEventListener("input", () => saveCreatorDefaults(state.creator));
    });

    qs("#btnAddScope").addEventListener("click", () => {
      state.scopeItems.push("");
      renderScopeList();
      renderDocument();
      scheduleAutosave();
      const rows = qsa("#scopeList textarea");
      if (rows.length) rows[rows.length - 1].focus();
    });

    qs("#btnAddPhase").addEventListener("click", () => {
      state.phases.push(newPhase());
      renderPhasesList();
      renderDocument();
      scheduleAutosave();
      const inputs = qsa("#phasesList .phase-block-head [data-field='name']");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    qs("#btnNew").addEventListener("click", onNewDocument);
    qs("#btnSave").addEventListener("click", onSaveDocument);
    qs("#btnDuplicate").addEventListener("click", onDuplicateDocument);
    qs("#btnReset").addEventListener("click", onResetDocument);
    qs("#btnLoad").addEventListener("click", openSavedModal);
    qs("#modalClose").addEventListener("click", closeSavedModal);
    qs("#modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeSavedModal(); });

    qs("#btnExportPdf").addEventListener("click", exportPdf);
    qs("#btnExportPng").addEventListener("click", exportPng);

    qs("#zoomIn").addEventListener("click", () => setZoom(zoom + 0.1));
    qs("#zoomOut").addEventListener("click", () => setZoom(zoom - 0.1));

    qsa("#mobileTabs .mobile-tab-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        qsa("#mobileTabs .mobile-tab-opt").forEach((b) => b.classList.toggle("is-active", b === btn));
        qs("#app").classList.toggle("mobile-tab-preview", btn.dataset.tab === "preview");
        if (btn.dataset.tab === "preview") requestAnimationFrame(() => { fitZoomToViewport(); renderPageBreakMarkers(); });
      });
    });

    window.addEventListener("beforeunload", (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  /* ---------------------------------------------------------- scope list editor */

  function renderScopeList() {
    const container = qs("#scopeList");
    container.innerHTML = state.scopeItems.map((text, idx) => `
      <div class="list-row" data-idx="${idx}">
        <span class="drag-handle">⋮⋮</span>
        <textarea rows="1" data-role="scope-text" placeholder="e.g. 3 Digital USP Videos, 10–15 seconds each">${escapeHtml(text)}</textarea>
        <div class="list-row-actions">
          <button type="button" class="mini-btn" data-action="up" title="Move up">▲</button>
          <button type="button" class="mini-btn" data-action="down" title="Move down">▼</button>
        </div>
        <div class="list-row-actions">
          <button type="button" class="mini-btn" data-action="dup" title="Duplicate">⧉</button>
          <button type="button" class="mini-btn mini-danger" data-action="del" title="Delete">✕</button>
        </div>
      </div>
    `).join("") || `<div class="saved-empty">No items yet.</div>`;

    qsa("textarea[data-role='scope-text']", container).forEach((ta) => {
      autoGrow(ta);
      ta.addEventListener("input", () => {
        const idx = Number(ta.closest(".list-row").dataset.idx);
        state.scopeItems[idx] = ta.value;
        autoGrow(ta);
        renderDocument();
        scheduleAutosave();
      });
    });

    qsa("[data-action]", container).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.closest(".list-row").dataset.idx);
        const action = btn.dataset.action;
        if (action === "up" && idx > 0) {
          [state.scopeItems[idx - 1], state.scopeItems[idx]] = [state.scopeItems[idx], state.scopeItems[idx - 1]];
        } else if (action === "down" && idx < state.scopeItems.length - 1) {
          [state.scopeItems[idx + 1], state.scopeItems[idx]] = [state.scopeItems[idx], state.scopeItems[idx + 1]];
        } else if (action === "dup") {
          state.scopeItems.splice(idx + 1, 0, state.scopeItems[idx]);
        } else if (action === "del") {
          state.scopeItems.splice(idx, 1);
        }
        renderScopeList();
        renderDocument();
        scheduleAutosave();
      });
    });
  }

  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  /* ---------------------------------------------------------- phases & services editor */

  function renderPhasesList() {
    const container = qs("#phasesList");
    container.innerHTML = state.phases.map((phase, pIdx) => phaseBlockTemplate(phase, pIdx)).join("")
      || `<div class="saved-empty">No phases yet.</div>`;

    qsa(".phase-block", container).forEach((phaseEl) => {
      const pIdx = Number(phaseEl.dataset.idx);
      const phase = state.phases[pIdx];

      qs("[data-field='name']", phaseEl).addEventListener("input", (e) => {
        phase.name = e.target.value;
        renderDocument();
        scheduleAutosave();
      });

      qsa(".phase-block-head [data-action]", phaseEl).forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          if (action === "up" && pIdx > 0) {
            [state.phases[pIdx - 1], state.phases[pIdx]] = [state.phases[pIdx], state.phases[pIdx - 1]];
          } else if (action === "down" && pIdx < state.phases.length - 1) {
            [state.phases[pIdx + 1], state.phases[pIdx]] = [state.phases[pIdx], state.phases[pIdx + 1]];
          } else if (action === "del") {
            if (phase.items.length && !confirm(`Delete phase "${phase.name.trim() || "Untitled"}" and its ${phase.items.length} item(s)?`)) return;
            state.phases.splice(pIdx, 1);
          }
          renderPhasesList();
          renderDocument();
          scheduleAutosave();
        });
      });

      qs("[data-action='add-item']", phaseEl).addEventListener("click", () => {
        phase.items.push(newServiceRow());
        renderPhasesList();
        renderDocument();
        scheduleAutosave();
        const inputs = qsa(".phase-items [data-field='name']", phaseEl);
        if (inputs.length) inputs[inputs.length - 1].focus();
      });

      const itemsContainer = qs(".phase-items", phaseEl);
      qsa(".service-row", itemsContainer).forEach((rowEl) => {
        const iIdx = Number(rowEl.dataset.idx);
        const row = phase.items[iIdx];

        qsa("[data-field]", rowEl).forEach((el) => {
          el.addEventListener("input", () => {
            const field = el.dataset.field;
            let val = el.value;
            if (["qty", "rate", "manualAmount"].includes(field)) val = val === "" ? 0 : Number(val);
            row[field] = val;
            updateRowAmountDisplay(rowEl, row);
            updatePhaseSubtotalDisplay(phaseEl, phase);
            renderDocument();
            scheduleAutosave();
          });
        });

        const toggle = qs("[data-field='showQtyUnit']", rowEl);
        toggle.addEventListener("change", () => {
          row.showQtyUnit = toggle.checked;
          renderPhasesList();
          renderDocument();
          scheduleAutosave();
        });

        qsa("[data-action]", rowEl).forEach((btn) => {
          btn.addEventListener("click", () => {
            const action = btn.dataset.action;
            if (action === "up" && iIdx > 0) {
              [phase.items[iIdx - 1], phase.items[iIdx]] = [phase.items[iIdx], phase.items[iIdx - 1]];
            } else if (action === "down" && iIdx < phase.items.length - 1) {
              [phase.items[iIdx + 1], phase.items[iIdx]] = [phase.items[iIdx], phase.items[iIdx + 1]];
            } else if (action === "dup") {
              const clone = deepClone(row);
              clone.id = uid();
              phase.items.splice(iIdx + 1, 0, clone);
            } else if (action === "del") {
              phase.items.splice(iIdx, 1);
            }
            renderPhasesList();
            renderDocument();
            scheduleAutosave();
          });
        });
      });
    });
  }

  function phaseBlockTemplate(phase, pIdx) {
    const itemsHtml = phase.items.map((row, iIdx) => serviceRowTemplate(row, iIdx)).join("")
      || `<div class="saved-empty saved-empty--tight">No items in this phase yet.</div>`;
    return `
      <div class="phase-block" data-idx="${pIdx}" data-id="${phase.id}">
        <div class="phase-block-head">
          <input type="text" data-field="name" value="${escapeHtml(phase.name)}" placeholder="Phase name (optional) — e.g. Pre-Production" />
          <div class="phase-block-actions">
            <button type="button" class="mini-btn" data-action="up" title="Move phase up">▲</button>
            <button type="button" class="mini-btn" data-action="down" title="Move phase down">▼</button>
            <button type="button" class="mini-btn mini-danger" data-action="del" title="Delete phase">✕</button>
          </div>
        </div>
        <div class="phase-items">${itemsHtml}</div>
        <div class="phase-block-foot">
          <button type="button" class="btn btn-add" data-action="add-item">+ Add item</button>
          <span class="phase-subtotal" data-phase-subtotal>Subtotal: ${escapeHtml(formatMoney(computePhaseSubtotal(phase), state))}</span>
        </div>
      </div>`;
  }

  function updatePhaseSubtotalDisplay(phaseEl, phase) {
    const el = qs("[data-phase-subtotal]", phaseEl);
    if (el) el.textContent = `Subtotal: ${formatMoney(computePhaseSubtotal(phase), state)}`;
  }

  function serviceRowTemplate(row, idx) {
    return `
      <div class="service-row" data-idx="${idx}" data-id="${row.id}">
        <div class="service-row-top">
          <input type="text" data-field="name" value="${escapeHtml(row.name)}" placeholder="Service / description (e.g. Motion Design)" />
        </div>
        <textarea data-field="detail" rows="1" placeholder="Optional detail">${escapeHtml(row.detail)}</textarea>
        ${row.showQtyUnit ? `
        <div class="service-row-grid">
          <label>Qty <input type="number" data-field="qty" min="0" step="any" value="${row.qty}" /></label>
          <label>Unit <input type="text" data-field="unit" value="${escapeHtml(row.unit)}" placeholder="pcs" /></label>
          <label>Rate <input type="number" data-field="rate" min="0" step="any" value="${row.rate}" /></label>
          <label>Amount <span class="service-amount" data-amount-display>${escapeHtml(formatMoney(rowAmount(row), state))}</span></label>
        </div>` : `
        <div class="service-row-grid" style="grid-template-columns:1fr;">
          <label>Amount <input type="number" data-field="manualAmount" min="0" step="any" value="${row.manualAmount}" /></label>
        </div>`}
        <div class="service-row-foot">
          <label><input type="checkbox" data-field="showQtyUnit" ${row.showQtyUnit ? "checked" : ""} /> Qty × Rate breakdown</label>
          <div class="service-row-actions">
            <button type="button" class="mini-btn" data-action="up" title="Move up">▲</button>
            <button type="button" class="mini-btn" data-action="down" title="Move down">▼</button>
            <button type="button" class="mini-btn" data-action="dup" title="Duplicate">⧉</button>
            <button type="button" class="mini-btn mini-danger" data-action="del" title="Delete">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  function updateRowAmountDisplay(rowEl, row) {
    const disp = qs("[data-amount-display]", rowEl);
    if (disp) disp.textContent = formatMoney(rowAmount(row), state);
  }

  /* ---------------------------------------------------------- document render */

  function renderDocument() {
    const page = qs("#docPage");
    page.innerHTML = buildDocumentHTML(state);
    requestAnimationFrame(renderPageBreakMarkers);
  }

  function buildDocumentHTML(st) {
    const isInvoice = st.type === "invoice";
    const c = st.creator || {};
    const contact = [c.email, c.phone, c.website].filter(Boolean);

    const header = `
      <div class="doc-header">
        <div class="doc-header-identity">
          <p class="doc-creator-name">${escapeHtml(c.name || "Your Name")}</p>
          <p class="doc-creator-title">${escapeHtml(c.title || "")}</p>
          <p class="doc-creator-spec">${escapeHtml(c.specialization || "")}</p>
          ${contact.length ? `<div class="doc-creator-contact">${contact.map((x) => `<span>${escapeHtml(x)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="doc-header-type">
          <p class="doc-type-label">${isInvoice ? "Invoice" : "Quotation"}</p>
          <p class="doc-type-number">${escapeHtml(st.meta.number || "")}</p>
          <div class="doc-type-dates">
            <div>${isInvoice ? "Invoice Date" : "Date"}: ${formatDate(st.meta.date)}</div>
            <div>${isInvoice ? "Due Date" : "Valid Until"}: ${formatDate(isInvoice ? st.meta.dueDate : st.meta.validUntil)}</div>
            ${isInvoice && st.sections.poRef && st.meta.poRef ? `<div>Ref / PO: ${escapeHtml(st.meta.poRef)}</div>` : ""}
          </div>
        </div>
      </div>`;

    const metaRow = `
      <div class="doc-meta-row">
        <div class="doc-meta-block">
          <div class="doc-meta-label">${isInvoice ? "Bill To" : "Client"}</div>
          <div class="doc-meta-value">${escapeHtml(st.client.name || "—")}</div>
          ${st.sections.clientAddress && st.client.address ? `<div class="doc-meta-sub">${escapeHtml(st.client.address)}</div>` : ""}
        </div>
        <div class="doc-meta-block">
          <div class="doc-meta-label">Project</div>
          <div class="doc-meta-value">${escapeHtml(st.project.name || "—")}</div>
          ${st.sections.projectDescription && st.project.description ? `<div class="doc-meta-sub">${escapeHtml(st.project.description)}</div>` : ""}
        </div>
      </div>`;

    const scopeItems = st.scopeItems.filter((s) => s.trim() !== "");
    const scopeSection = (st.sections.scope && scopeItems.length) ? `
      <div class="doc-section">
        <div class="doc-section-title">Scope &amp; Deliverables</div>
        <ul class="doc-scope-list">${scopeItems.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
      </div>` : "";

    const servicesSection = buildServicesHTML(st);
    const totals = computeTotals(st);
    const totalsSection = buildTotalsHTML(st, totals);

    const termsSections = [
      ["revision", "Revision Terms", st.terms.revision],
      ["exclusions", "Exclusions", st.terms.exclusions],
      ["paymentTerms", "Payment Terms", st.terms.paymentTerms],
      ["notes", "Notes", st.terms.notes],
    ].map(([key, label, text]) => {
      if (!st.sections[key] || !text || !text.trim()) return "";
      return `<div class="doc-section">
        <div class="doc-section-title">${escapeHtml(label)}</div>
        <div class="doc-section-body">${escapeHtml(text)}</div>
      </div>`;
    }).join("");

    const p = st.payment || {};
    const hasPaymentInfo = p.bankName || p.accountName || p.accountNumber;
    const paymentSection = (isInvoice && st.sections.paymentDetails && hasPaymentInfo) ? `
      <div class="doc-section">
        <div class="doc-section-title">Payment Details</div>
        <div class="payment-box">
          ${p.bankName ? `<div class="payment-box-item"><div class="doc-meta-label">Bank</div><div class="doc-meta-value">${escapeHtml(p.bankName)}</div></div>` : ""}
          ${p.accountName ? `<div class="payment-box-item"><div class="doc-meta-label">Account Name</div><div class="doc-meta-value">${escapeHtml(p.accountName)}</div></div>` : ""}
          ${p.accountNumber ? `<div class="payment-box-item"><div class="doc-meta-label">Account Number</div><div class="doc-meta-value">${escapeHtml(p.accountNumber)}</div></div>` : ""}
        </div>
      </div>` : "";

    const footer = `
      <div class="doc-footer">
        <span>${escapeHtml(c.name || "")}</span>
        <span>${isInvoice ? "Thank you for your business." : "This quotation is valid until the date stated above."}</span>
      </div>`;

    return header + metaRow + scopeSection + servicesSection + totalsSection + termsSections + paymentSection + footer;
  }

  function serviceDocRowHtml(row, anyBreakdown, st) {
    const amount = rowAmount(row);
    const nameCell = `<div class="svc-name">${escapeHtml(row.name || "—")}</div>${row.detail ? `<div class="svc-detail">${escapeHtml(row.detail)}</div>` : ""}`;
    let breakdownCells = "";
    if (anyBreakdown) {
      breakdownCells = row.showQtyUnit
        ? `<td class="col-num">${escapeHtml(String(row.qty ?? ""))}</td><td class="col-num">${escapeHtml(row.unit || "")}</td><td class="col-num">${formatMoney(row.rate, st)}</td>`
        : `<td class="col-num">—</td><td class="col-num">—</td><td class="col-num">—</td>`;
    }
    return `<tr><td>${nameCell}</td>${breakdownCells}<td class="col-amount col-num">${formatMoney(amount, st)}</td></tr>`;
  }

  function buildServicesHTML(st) {
    const phasesWithItems = st.phases.filter((p) => p.items.length);
    const allItems = phasesWithItems.flatMap((p) => p.items);
    const anyBreakdown = allItems.some((r) => r.showQtyUnit);
    const colCount = anyBreakdown ? 5 : 2;
    // A single unnamed phase is the common "simple project" case — render it
    // as a flat list with no group header/subtotal, matching the old layout.
    // Multiple phases, or any phase someone bothered to name, get grouped.
    const showGrouping = phasesWithItems.length > 1 || phasesWithItems.some((p) => p.name.trim());

    const rows = phasesWithItems.map((phase, i) => {
      const label = phase.name.trim() || "Services";
      let html = "";
      if (showGrouping) {
        html += `<tr class="phase-row${i === 0 ? " phase-row--first" : ""}"><td colspan="${colCount}">${escapeHtml(label)}</td></tr>`;
      }
      html += phase.items.map((row) => serviceDocRowHtml(row, anyBreakdown, st)).join("");
      if (showGrouping) {
        const leadColspan = colCount - 2;
        const leadTd = leadColspan > 0 ? `<td colspan="${leadColspan}"></td>` : "";
        html += `<tr class="phase-subtotal-row">${leadTd}<td class="phase-subtotal-label">Subtotal ${escapeHtml(label)}</td><td class="col-amount">${formatMoney(computePhaseSubtotal(phase), st)}</td></tr>`;
      }
      return html;
    }).join("");

    return `
      <div class="doc-services">
        <div class="doc-section-title">Services &amp; Fees</div>
        <table class="services-table">
          <thead>
            <tr>
              <th>Description</th>
              ${anyBreakdown ? `<th class="col-num">Qty</th><th class="col-num">Unit</th><th class="col-num">Rate</th>` : ""}
              <th class="col-num">Amount</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="${colCount}">No services added yet.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  function buildTotalsHTML(st, totals) {
    const isInvoice = st.type === "invoice";
    const lines = [`<div class="totals-line"><span>Subtotal</span><span>${formatMoney(totals.subtotal, st)}</span></div>`];
    if (st.sections.discount && totals.discountAmt) {
      const label = st.calc.discountType === "percent" ? `Discount (${st.calc.discountValue}%)` : "Discount";
      lines.push(`<div class="totals-line is-subtle"><span>${escapeHtml(label)}</span><span>−${formatMoney(totals.discountAmt, st)}</span></div>`);
    }
    if (st.sections.additionalCost && totals.additionalAmt) {
      const label = st.calc.additionalCostLabel || "Additional Cost";
      lines.push(`<div class="totals-line is-subtle"><span>${escapeHtml(label)}</span><span>+${formatMoney(totals.additionalAmt, st)}</span></div>`);
    }
    return `
      <div class="doc-totals"><div class="doc-totals-inner">
        ${lines.join("")}
        <div class="totals-final">
          <span class="totals-final-label">${isInvoice ? "Amount Due" : "Total Project Fee"}</span>
          <span class="totals-final-value">${formatMoney(totals.total, st)}</span>
        </div>
      </div></div>`;
  }

  /* ---------------------------------------------------------- page-break preview markers */

  function renderPageBreakMarkers(preserveScroll) {
    const page = qs("#docPage");
    qsa(".page-break-marker", page).forEach((m) => m.remove());
    // offsetWidth (layout box) is used rather than getBoundingClientRect()
    // (visual box) because the stage may be CSS-scaled by the zoom control —
    // scrollHeight below is always a layout value, so both must match.
    const layoutWidth = page.offsetWidth;
    if (!layoutWidth) return;
    const pxPerMm = layoutWidth / 210;
    const pageHeightPx = pxPerMm * 297;
    const totalHeightPx = page.scrollHeight;
    let y = pageHeightPx;
    // small tolerance absorbs mm->px rounding so a single-page doc (height
    // equal to the min-height page) never draws a spurious break at the edge
    while (y < totalHeightPx - 24) {
      const marker = document.createElement("div");
      marker.className = "page-break-marker";
      marker.style.top = y + "px";
      page.appendChild(marker);
      y += pageHeightPx;
    }
  }

  /* ---------------------------------------------------------- zoom */

  let zoom = 0.82;
  function setZoom(val) {
    zoom = Math.min(1.4, Math.max(0.25, Math.round(val * 100) / 100));
    qs("#a4Stage").style.setProperty("--zoom", zoom);
    qs("#zoomLevel").textContent = Math.round(zoom * 100) + "%";
    requestAnimationFrame(renderPageBreakMarkers);
  }

  // On narrow screens, shrink the zoom so the A4 page fits the viewport
  // width instead of overflowing sideways. Only shrinks — a user's manual
  // zoom-in via the +/- buttons is left alone until the next resize.
  const MM_TO_PX = 96 / 25.4;
  function fitZoomToViewport() {
    const scrollEl = qs("#previewScroll");
    // skip while hidden (e.g. the mobile "Edit" tab is active) — clientWidth
    // would read 0 there and incorrectly collapse the zoom to its floor
    if (!scrollEl || scrollEl.clientWidth === 0) return;
    const available = scrollEl.clientWidth - 32;
    const naturalWidthPx = 210 * MM_TO_PX;
    const fitZoom = available / naturalWidthPx;
    if (fitZoom < zoom) setZoom(fitZoom);
  }

  /* ---------------------------------------------------------- document actions */

  function onNewDocument() {
    if (dirty && !confirm("Start a new document? Unsaved changes to the current one will be lost from the working draft (saved documents are unaffected).")) return;
    state = defaultState(state.type);
    markClean();
    syncControlsFromState();
    try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(state)); } catch (e) { /* ignore */ }
    showToast("New document created");
  }

  function onSaveDocument() {
    const list = loadSavedDocs();
    state.savedAt = new Date().toISOString();
    const existingIdx = list.findIndex((d) => d.id === state.id);
    const snapshot = deepClone(state);
    if (existingIdx >= 0) list[existingIdx] = snapshot; else list.unshift(snapshot);
    persistSavedDocs(list);
    markClean();
    updateSavedCount();
    showToast("Document saved");
  }

  function onDuplicateDocument() {
    const clone = deepClone(state);
    clone.id = uid();
    clone.savedAt = null;
    state = clone;
    dirty = true;
    syncControlsFromState();
    scheduleAutosave();
    showToast("Duplicated — edit and save when ready");
  }

  function onResetDocument() {
    if (!confirm("Reset all fields in this document to default? This cannot be undone.")) return;
    const keepType = state.type;
    state = defaultState(keepType);
    markClean();
    syncControlsFromState();
    try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(state)); } catch (e) { /* ignore */ }
    showToast("Document reset");
  }

  function updateSavedCount() {
    qs("#savedCount").textContent = loadSavedDocs().length;
  }

  /* ---------------------------------------------------------- saved documents modal */

  function openSavedModal() {
    const list = loadSavedDocs();
    const body = qs("#savedList");
    if (!list.length) {
      body.innerHTML = `<div class="saved-empty">No saved documents yet. Use “Save” to keep a copy here.</div>`;
    } else {
      body.innerHTML = list
        .slice()
        .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
        .map((doc) => {
          const totals = computeTotals(doc);
          const title = [doc.client.name || "Untitled Client", doc.project.name || "Untitled Project"].join(" — ");
          const meta = `${doc.type === "invoice" ? "Invoice" : "Quotation"} · ${doc.meta.number || ""} · ${formatDate(doc.meta.date)}`;
          return `<div class="saved-item" data-id="${doc.id}">
            <div class="saved-item-info">
              <div class="saved-item-title">${escapeHtml(title)}</div>
              <div class="saved-item-meta">${escapeHtml(meta)}</div>
            </div>
            <div style="display:flex;align-items:center;">
              <span class="saved-item-total">${escapeHtml(formatMoney(totals.total, doc))}</span>
              <button type="button" class="mini-btn mini-danger" data-del="${doc.id}" title="Delete">✕</button>
            </div>
          </div>`;
        }).join("");
    }
    qs("#modalBackdrop").hidden = false;

    qsa(".saved-item", body).forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.closest("[data-del]")) return;
        loadSavedDoc(item.dataset.id);
      });
    });
    qsa("[data-del]", body).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("Delete this saved document? This cannot be undone.")) return;
        const list2 = loadSavedDocs().filter((d) => d.id !== btn.dataset.del);
        persistSavedDocs(list2);
        openSavedModal();
        updateSavedCount();
      });
    });
  }

  function closeSavedModal() { qs("#modalBackdrop").hidden = true; }

  function loadSavedDoc(id) {
    if (dirty && !confirm("Load this document? Unsaved changes in the current draft will be lost.")) return;
    const doc = loadSavedDocs().find((d) => d.id === id);
    if (!doc) return;
    state = deepClone(doc);
    markClean();
    syncControlsFromState();
    try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(state)); } catch (e) { /* ignore */ }
    closeSavedModal();
    showToast("Document loaded");
  }

  /* ---------------------------------------------------------- export */

  // iOS WebKit quirks: every iOS browser (Safari, Chrome, Firefox, etc.) is a
  // WebKit wrapper, and window.print() is unreliable outside Safari itself —
  // Chrome/Firefox-on-iOS often silently do nothing when it's called.
  function isIOS() {
    return /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isIOSNonSafari() {
    return isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  }

  function exportPdf() {
    if (isIOSNonSafari()) {
      showToast("Di iPhone, PDF export paling stabil lewat Safari — buka link ini di Safari lalu coba lagi");
    } else {
      showToast("Opening print dialog — choose “Save as PDF”");
    }
    setTimeout(() => window.print(), 150);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function exportPng() {
    const stage = qs("#a4Stage");
    const page = qs("#docPage");
    const prevZoomStyle = stage.style.getPropertyValue("--zoom");
    stage.style.setProperty("--zoom", "1");
    page.classList.add("is-exporting");
    qsa(".page-break-marker", page).forEach((m) => (m.style.display = "none"));

    try {
      const canvas = await html2canvas(page, {
        scale: 2,
        backgroundColor: "#f6f2e9",
        useCORS: true,
      });

      const layoutWidth = page.offsetWidth;
      const pxPerMm = layoutWidth / 210;
      const pageHeightCss = pxPerMm * 297;
      const scaleFactor = canvas.width / layoutWidth;
      const pageHeightCanvas = Math.round(pageHeightCss * scaleFactor);
      const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightCanvas));
      const baseName = (state.meta.number || (state.type === "invoice" ? "invoice" : "quotation")).replace(/[^a-z0-9-_]+/gi, "-");

      const files = [];
      if (totalPages <= 1) {
        const blob = await canvasToBlob(canvas);
        files.push(new File([blob], `${baseName}.png`, { type: "image/png" }));
      } else {
        for (let i = 0; i < totalPages; i++) {
          const sliceHeight = Math.min(pageHeightCanvas, canvas.height - i * pageHeightCanvas);
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeight;
          const ctx = sliceCanvas.getContext("2d");
          ctx.drawImage(canvas, 0, i * pageHeightCanvas, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
          const blob = await canvasToBlob(sliceCanvas);
          files.push(new File([blob], `${baseName}-page-${i + 1}.png`, { type: "image/png" }));
        }
      }

      await deliverFiles(files);
    } catch (err) {
      console.error(err);
      showToast("PNG export failed — see console for details");
    } finally {
      stage.style.setProperty("--zoom", prevZoomStyle || String(zoom));
      page.classList.remove("is-exporting");
      requestAnimationFrame(renderPageBreakMarkers);
    }
  }

  // Mobile Safari/Chrome-iOS don't reliably support programmatic downloads
  // via <a download> (especially after an async gap like html2canvas), so
  // prefer the native share sheet — which also gives an unmistakable success
  // signal instead of a download that silently lands somewhere unseen.
  async function deliverFiles(files) {
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: state.meta.number || "Document" });
        showToast(files.length > 1 ? `Dibagikan ${files.length} halaman` : "Siap disimpan");
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // user cancelled the share sheet
        // otherwise fall through to the direct-download fallback below
      }
    }
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
    showToast(files.length > 1 ? `Exported ${files.length} PNG pages` : "PNG downloaded");
  }

  /* ---------------------------------------------------------- toast */

  let toastTimer = null;
  function showToast(msg) {
    const el = qs("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------------------------------------------------------- init */

  function init() {
    const stage = qs("#a4Stage");
    const page = document.createElement("div");
    page.className = "a4-page";
    page.id = "docPage";
    stage.appendChild(page);

    bindControlEvents();
    syncControlsFromState();
    setZoom(zoom);
    fitZoomToViewport();
    updateSaveStatus();

    window.addEventListener("resize", () => requestAnimationFrame(() => { fitZoomToViewport(); renderPageBreakMarkers(); }));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
