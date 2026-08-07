(function () {
  'use strict';

  var BACKEND_QUOTE_URL = 'http://localhost:3001/api/get-quote';

  var AI_CATEGORIES = {
    'Agentic Workflows': ['Multi-step process orchestration', 'ERP & CRM-connected agents', 'Decision-support & approvals', 'Cross-agent coordination'],
    'Conversational AI & Copilots': ['Employee self-service copilots', 'Customer-facing assistants', 'Embedded in-product assistants', 'Teams / Slack-native bots'],
    'Document Intelligence (IDP)': ['Contract & KYC review', 'Invoice & PO extraction', 'Loan document assessment', 'Automated data validation'],
    'Voice AI & Telephony': ['Natural speech support agents', 'Live ERP-connected resolution', 'Automated ticket escalation', 'Inbound / outbound calling'],
    'Predictive & GenAI Analytics': ['Lead scoring & qualification', 'Competitor benchmarking', 'Demand forecasting', 'Product recommendation engines'],
    'Recruiting & Talent Intelligence': ['Resume & profile screening', 'Fit scoring (1-10)', 'Automated shortlisting', 'Salary benchmarking']
  };

  var RPA_CATEGORIES = {
    'Finance & Accounting': ['Invoice & PO matching', 'Reconciliations', 'Expense report processing', 'Month-end close tasks'],
    'HR & Recruitment': ['Onboarding & offboarding', 'Payroll processing', 'Candidate screening', 'Leave & benefits admin'],
    'Customer Support': ['Ticket triage & routing', 'Order status lookups', 'Refund processing', 'FAQ / knowledge base replies'],
    'Sales & Marketing': ['Lead scoring & routing', 'CRM data entry', 'Campaign reporting', 'Outbound outreach'],
    'Supply Chain & Procurement': ['Vendor onboarding checks', 'PO-to-SO conversion', 'Inventory tracking', 'Shipment status updates'],
    'IT Operations': ['Access provisioning', 'Password resets', 'System health monitoring', 'Ticket escalation'],
    'Legal & Compliance': ['Contract review & flagging', 'KYC / AML checks', 'Audit trail generation', 'Document classification'],
    'Insurance & Claims': ['Claims intake & triage', 'Policy servicing', 'Underwriting support', 'Renewal processing']
  };

  var chips = document.querySelectorAll('.quote-chip');
  var conditional = document.getElementById('qConditional');
  var form = document.getElementById('quoteForm');
  var submitBtn = document.getElementById('qSubmitBtn');
  var statusEl = document.getElementById('qStatus');

  if (!form) return;

  var activeNeed = 'Agentic AI';
  var catSelect = null;
  var catOtherInput = null;
  var procList = null;
  var procOtherInput = null;

  function renderConditional() {
    conditional.innerHTML = '';
    catSelect = null; catOtherInput = null; procList = null; procOtherInput = null;

    var map = activeNeed === 'Agentic AI' ? AI_CATEGORIES : activeNeed === 'RPA' ? RPA_CATEGORIES : null;
    if (!map) return;

    var catLabel = activeNeed === 'Agentic AI' ? 'AI category' : 'Process area';

    var catField = document.createElement('div');
    catField.className = 'quote-field';
    catField.innerHTML = '<label>' + catLabel + ' <span class="quote-hint">- pick one *</span></label>';
    catSelect = document.createElement('select');
    Object.keys(map).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k; opt.textContent = k;
      catSelect.appendChild(opt);
    });
    var otherCatOpt = document.createElement('option');
    otherCatOpt.value = 'Other'; otherCatOpt.textContent = 'Other';
    catSelect.appendChild(otherCatOpt);
    catField.appendChild(catSelect);

    catOtherInput = document.createElement('input');
    catOtherInput.type = 'text';
    catOtherInput.placeholder = 'Describe your category...';
    catOtherInput.className = 'quote-other-input';
    catOtherInput.style.display = 'none';
    catField.appendChild(catOtherInput);
    conditional.appendChild(catField);

    var procField = document.createElement('div');
    procField.className = 'quote-field';
    procField.innerHTML = '<label>Which process? <span class="quote-hint">- pick as many as apply *</span></label>';
    procList = document.createElement('div');
    procList.className = 'quote-process-list';
    procField.appendChild(procList);

    procOtherInput = document.createElement('input');
    procOtherInput.type = 'text';
    procOtherInput.placeholder = 'Describe your process...';
    procOtherInput.className = 'quote-other-input';
    procOtherInput.style.display = 'none';
    procField.appendChild(procOtherInput);
    conditional.appendChild(procField);

    function fillProcesses(cat) {
      procList.innerHTML = '';
      var items = map[cat] || [];
      items.forEach(function (p) {
        procList.appendChild(processRow(p));
      });
      var otherRow = processRow('Other (describe below)');
      var otherBox = otherRow.querySelector('input');
      otherBox.addEventListener('change', function () {
        procOtherInput.style.display = otherBox.checked ? 'block' : 'none';
      });
      procList.appendChild(otherRow);
    }

    function processRow(label) {
      var row = document.createElement('label');
      row.className = 'quote-process-row';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.value = label;
      row.appendChild(box);
      var span = document.createElement('span');
      span.textContent = label;
      row.appendChild(span);
      return row;
    }

    fillProcesses(catSelect.value);

    catSelect.addEventListener('change', function () {
      catOtherInput.style.display = catSelect.value === 'Other' ? 'block' : 'none';
      procOtherInput.style.display = 'none';
      fillProcesses(catSelect.value);
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      activeNeed = chip.getAttribute('data-chip');
      chips.forEach(function (c) { c.classList.toggle('active', c === chip); });
      renderConditional();
    });
  });

  renderConditional();

  function clearErrors() {
    form.querySelectorAll('.quote-error').forEach(function (el) { el.classList.remove('quote-error'); });
  }

  function markError(fieldEl) {
    var wrap = fieldEl.closest('.quote-field');
    if (wrap) wrap.classList.add('quote-error');
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'quote-status' + (kind ? ' ' + kind : '');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    setStatus('', '');

    var nameEl = document.getElementById('qName');
    var emailEl = document.getElementById('qEmail');
    var companyEl = document.getElementById('qCompany');
    var problemEl = document.getElementById('qProblem');

    var valid = true;
    [nameEl, emailEl, companyEl, problemEl].forEach(function (el) {
      if (!el.value.trim()) { markError(el); valid = false; }
    });
    if (emailEl.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) {
      markError(emailEl); valid = false;
    }

    var category = '';
    var processes = [];
    if (catSelect) {
      category = catSelect.value === 'Other' ? (catOtherInput.value.trim() || 'Other') : catSelect.value;
      if (catSelect.value === 'Other' && !catOtherInput.value.trim()) { markError(catOtherInput); valid = false; }

      var checked = procList.querySelectorAll('input[type="checkbox"]:checked');
      checked.forEach(function (box) {
        if (box.value.indexOf('Other') === 0) {
          processes.push(procOtherInput.value.trim() ? 'Other: ' + procOtherInput.value.trim() : 'Other');
        } else {
          processes.push(box.value);
        }
      });
      if (checked.length === 0) { valid = false; }
      var otherChecked = Array.prototype.some.call(checked, function (b) { return b.value.indexOf('Other') === 0; });
      if (otherChecked && !procOtherInput.value.trim()) { markError(procOtherInput); valid = false; }
    }

    if (!valid) {
      setStatus('Please fill in the required fields.', 'error');
      return;
    }

    var payload = {
      name: nameEl.value.trim(),
      email: emailEl.value.trim(),
      phone: document.getElementById('qPhone').value.trim(),
      company: companyEl.value.trim(),
      companySize: document.getElementById('qCompanySize').value,
      industry: document.getElementById('qIndustry').value.trim(),
      needHelp: activeNeed,
      category: category,
      processes: processes,
      problem: problemEl.value.trim(),
      budget: document.getElementById('qBudget').value,
      timeline: document.getElementById('qTimeline').value,
      hearAbout: document.getElementById('qHear').value,
      submittedAt: new Date().toLocaleString()
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    fetch(BACKEND_QUOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed');
        return res.json();
      })
      .then(function () {
        setStatus('Thanks! Your quote request is in — we\'ll be in touch within 1 business day.', 'success');
        form.reset();
        chips.forEach(function (c) { c.classList.toggle('active', c.getAttribute('data-chip') === 'Agentic AI'); });
        activeNeed = 'Agentic AI';
        renderConditional();
      })
      .catch(function () {
        setStatus('Something went wrong sending your request. Make sure the backend is running (npm start), or email us directly.', 'error');
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Request My Quote →';
      });
  });
})();
