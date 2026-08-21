(function () {
  'use strict';

  // If this page is restored from the browser's back/forward cache (e.g.
  // hitting Back after logging out), force a real reload so the /api/me
  // check below runs again instead of showing the stale cached view.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) window.location.reload();
  });

  var params = new URLSearchParams(window.location.search);
  var me = null;
  var accountId = null;
  var currentData = null;
  var leadsViewMode = 'kanban';

  function timeAgo(ts) {
    if (!ts) return '—';
    var diff = Date.now() - ts;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  function metricCard(label, value, cls) {
    return '<div class="metric-card"><div class="label">' + label + '</div><div class="value' + (cls ? ' ' + cls : '') + '">' + value + '</div></div>';
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function toDatetimeLocalValue(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ---- Generic table toolbar: search + filters + row selection ----
  // Every table (Leads, Brokers, Inventory, Accounting, Team) plugs into
  // this the same way: keep a small state object (search text, filter
  // values, selected-id set) keyed by table name, apply it client-side
  // against whatever's already in currentData, and re-render just that
  // table's markup — no re-fetch needed.
  var SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  var tt = {}; // name -> { search, filters:{}, selected:Set }
  var ttRenderFns = {}; // name -> function to call to re-render that table
  var ttVisibleIds = {}; // name -> function returning the currently-visible row ids (for select-all)

  function ttState(name) {
    if (!tt[name]) tt[name] = { search: '', filters: {}, selected: new Set() };
    return tt[name];
  }

  function ttSearchMatch(state, row, fields) {
    if (!state.search) return true;
    var q = state.search.toLowerCase();
    return fields.some(function (f) {
      var v = row[f];
      return v !== null && v !== undefined && String(v).toLowerCase().indexOf(q) !== -1;
    });
  }

  // matchers: { filterKey: function(row, filterValue) -> boolean }
  function ttFilterMatch(state, row, matchers) {
    for (var key in matchers) {
      var val = state.filters[key];
      if (val === undefined || val === null || val === '') continue;
      if (!matchers[key](row, val)) return false;
    }
    return true;
  }

  function ttApply(name, rows, searchFields, matchers) {
    var state = ttState(name);
    return rows.filter(function (r) { return ttSearchMatch(state, r, searchFields) && ttFilterMatch(state, r, matchers); });
  }

  function ttToolbarActive(name) {
    var state = ttState(name);
    if (state.search) return true;
    for (var k in state.filters) { if (state.filters[k] !== undefined && state.filters[k] !== null && state.filters[k] !== '') return true; }
    return false;
  }

  function ttSelectionBarHTML(name, itemLabel) {
    var n = ttState(name).selected.size;
    if (!n) return '';
    return '<div class="tt-selection-bar show"><span>' + n + ' ' + itemLabel + (n === 1 ? '' : 's') + ' selected</span>' +
      '<button class="tt-reset" type="button" data-tt-clear="' + name + '">Clear selection</button></div>';
  }

  function ttHeaderCheckboxHTML(name) {
    var state = ttState(name);
    var ids = ttVisibleIds[name] ? ttVisibleIds[name]() : [];
    var allSelected = ids.length > 0 && ids.every(function (id) { return state.selected.has(id); });
    var someSelected = !allSelected && ids.some(function (id) { return state.selected.has(id); });
    return '<input type="checkbox" class="tt-checkbox" data-tt-select-all="' + name + '"' + (allSelected ? ' checked' : '') + (someSelected ? ' data-tt-indeterminate="1"' : '') + '>';
  }

  function ttRowCheckboxHTML(name, id) {
    return '<input type="checkbox" class="tt-checkbox" data-tt-select="' + name + '" data-tt-id="' + id + '"' + (ttState(name).selected.has(id) ? ' checked' : '') + '>';
  }

  function ttApplyIndeterminate() {
    document.querySelectorAll('[data-tt-indeterminate="1"]').forEach(function (el) { el.indeterminate = true; });
  }

  function ttRerender(name) { if (ttRenderFns[name]) ttRenderFns[name](); }

  // Search inputs / filter selects / range inputs all share this: update
  // the matching state field and re-render. `field` is either "search" or
  // a dotted "filters.key".
  function ttBindControl(el, name, field) {
    if (!el) return;
    el.addEventListener('input', function () {
      var state = ttState(name);
      if (field === 'search') state.search = el.value;
      else state.filters[field] = el.value;
      ttRerender(name);
    });
    if (el.tagName === 'SELECT') {
      el.addEventListener('change', function () {
        ttState(name).filters[field] = el.value;
        ttRerender(name);
      });
    }
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches && t.matches('[data-tt-select]')) {
      var name = t.getAttribute('data-tt-select');
      var id = t.getAttribute('data-tt-id');
      var state = ttState(name);
      if (t.checked) state.selected.add(id); else state.selected.delete(id);
      ttRerender(name);
    } else if (t.matches && t.matches('[data-tt-select-all]')) {
      var name2 = t.getAttribute('data-tt-select-all');
      var state2 = ttState(name2);
      var ids = ttVisibleIds[name2] ? ttVisibleIds[name2]() : [];
      if (t.checked) ids.forEach(function (id) { state2.selected.add(id); });
      else ids.forEach(function (id) { state2.selected.delete(id); });
      ttRerender(name2);
    }
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-tt-clear]');
    if (t) { ttState(t.getAttribute('data-tt-clear')).selected.clear(); ttRerender(t.getAttribute('data-tt-clear')); }
  });

  function loadAccount() {
    fetch('/api/accounts/' + accountId).then(function (res) {
      if (res.status === 401) { window.location.href = '/login.html'; throw new Error('redirect'); }
      if (!res.ok) throw new Error('load-failed');
      return res.json();
    }).then(render).catch(function (err) {
      if (err.message === 'redirect') return;
      console.error(err);
      document.getElementById('pageLoading').innerHTML = 'Couldn\'t load this dashboard. Try refreshing the page.';
    });
  }

  var STATUS_CLASS = { 'New': '', 'Contacted': '', 'Hot': 'warn', 'Cold': '', 'Converted': 'mint' };

  function renderKanban(data) {
    var board = document.getElementById('leadsKanban');
    board.innerHTML = data.statuses.map(function (status) {
      var leadsInStage = data.leads.filter(function (l) { return l.status === status; });
      var totalValue = data.pipelineValue ? (data.pipelineValue[status] || 0) : 0;
      var cards = leadsInStage.map(function (l) {
        return '<div class="kanban-card" draggable="true" data-lead-id="' + l.id + '">' +
          '<div class="lead-name">' + l.name + '</div>' +
          '<div class="lead-company">' + l.company + '</div>' +
          (l.value ? '<div class="lead-value">$' + Number(l.value).toLocaleString() + '</div>' : '') +
          '<div class="lead-meta">' + l.source + (l.lastContacted ? ' · ' + l.lastContacted : '') + '</div>' +
          '</div>';
      }).join('') || '<div class="kanban-empty">No leads</div>';
      return '<div class="kanban-column" data-status="' + status + '">' +
        '<div class="kanban-column-head"><span class="name">' + status + '</span><span class="count">' + leadsInStage.length + '</span></div>' +
        (totalValue ? '<div class="kanban-column-value">$' + totalValue.toLocaleString() + '</div>' : '') +
        cards +
        '</div>';
    }).join('');

    board.querySelectorAll('.kanban-card').forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.getAttribute('data-lead-id'));
      });
      card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
      card.addEventListener('click', function () { openLeadDetail(card.getAttribute('data-lead-id')); });
    });

    board.querySelectorAll('.kanban-column').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', function () { col.classList.remove('drag-over'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('drag-over');
        var leadId = e.dataTransfer.getData('text/plain');
        var status = col.getAttribute('data-status');
        if (!leadId) return;
        fetch('/api/accounts/' + accountId + '/leads/' + leadId + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: status })
        }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
          .then(function (r) {
            if (!r.ok) { showToast(r.d.error); return; }
            loadAccount();
          });
      });
    });
  }

  function renderLeadsList(data) {
    document.getElementById('leadsBody').innerHTML = data.leads.map(function (l) {
      return '<tr><td>' + l.name + '</td><td>' + l.company + '</td>' +
        '<td><span class="status-pill status-' + l.status + '">' + l.status + '</span></td>' +
        '<td>' + (l.value ? '$' + Number(l.value).toLocaleString() : '—') + '</td>' +
        '<td>' + l.source + '</td><td>' + (l.lastContacted || '—') + '</td>' +
        '<td style="text-align:right;"><button class="link-btn" data-edit-lead="' + l.id + '">Edit</button></td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty-note">No leads yet — try "Read emails & find new leads".</td></tr>';
    document.querySelectorAll('[data-edit-lead]').forEach(function (btn) {
      btn.addEventListener('click', function () { openLeadDetail(btn.getAttribute('data-edit-lead')); });
    });
  }

  function setLeadsView(mode) {
    leadsViewMode = mode;
    document.querySelectorAll('[data-leads-view]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-leads-view') === mode);
    });
    document.getElementById('leadsKanban').style.display = mode === 'kanban' ? '' : 'none';
    document.getElementById('leadsTable').style.display = mode === 'list' ? '' : 'none';
  }

  document.querySelectorAll('[data-leads-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { setLeadsView(btn.getAttribute('data-leads-view')); });
  });

  // ---- add lead modal ----
  var addLeadModal = document.getElementById('addLeadModal');
  document.getElementById('addLeadBtn').addEventListener('click', function () {
    if (!currentData) return;
    var select = document.getElementById('leadStatus');
    select.innerHTML = currentData.statuses.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
    ['leadName', 'leadCompany', 'leadValue', 'leadSource'].forEach(function (id) { document.getElementById(id).value = ''; });
    addLeadModal.classList.add('show');
  });
  document.getElementById('addLeadClose').addEventListener('click', function () { addLeadModal.classList.remove('show'); });
  addLeadModal.addEventListener('click', function (e) { if (e.target === addLeadModal) addLeadModal.classList.remove('show'); });
  document.getElementById('leadSubmit').addEventListener('click', function () {
    var name = document.getElementById('leadName').value.trim();
    var company = document.getElementById('leadCompany').value.trim();
    if (!name || !company) { showToast('Name and company are required.'); return; }
    var payload = {
      name: name, company: company,
      status: document.getElementById('leadStatus').value,
      value: Number(document.getElementById('leadValue').value) || 0,
      source: document.getElementById('leadSource').value.trim() || 'Manual entry'
    };
    var btn = document.getElementById('leadSubmit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Adding...';
    fetch('/api/accounts/' + accountId + '/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Add lead';
        if (!r.ok) { showToast(r.d.error); return; }
        addLeadModal.classList.remove('show');
        showToast('Lead added.');
        loadAccount();
      });
  });

  // ---- lead detail modal (edit + per-lead activity) ----
  var leadDetailModal = document.getElementById('leadDetailModal');
  var currentLeadId = null;

  function openLeadDetail(leadId) {
    if (!currentData) return;
    var l = currentData.leads.filter(function (x) { return x.id === leadId; })[0];
    if (!l) return;
    currentLeadId = leadId;

    document.getElementById('ldName').value = l.name;
    document.getElementById('ldCompany').value = l.company;
    var select = document.getElementById('ldStatus');
    select.innerHTML = currentData.statuses.map(function (s) {
      return '<option value="' + s + '"' + (s === l.status ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    document.getElementById('ldValue').value = l.value || 0;
    document.getElementById('ldSource').value = l.source || '';
    document.getElementById('ldLastContacted').value = l.lastContacted || '';

    document.getElementById('ldActivity').innerHTML = '<div class="empty-note"><span class="spinner"></span> Loading...</div>';
    leadDetailModal.classList.add('show');

    fetch('/api/accounts/' + accountId + '/leads/' + leadId + '/activity').then(function (res) {
      return res.json();
    }).then(function (d) {
      var items = d.activity || [];
      document.getElementById('ldActivity').innerHTML = items.map(function (item) {
        return '<div class="activity-item">' + item.text +
          '<div class="when">' + timeAgo(item.at) + (item.actor ? ' · ' + item.actor : '') + '</div></div>';
      }).join('') || '<div class="empty-note">No activity on this lead yet.</div>';
    }).catch(function () {
      document.getElementById('ldActivity').innerHTML = '<div class="empty-note">Couldn\'t load activity.</div>';
    });
  }

  document.getElementById('ldClose').addEventListener('click', function () { leadDetailModal.classList.remove('show'); });
  leadDetailModal.addEventListener('click', function (e) { if (e.target === leadDetailModal) leadDetailModal.classList.remove('show'); });
  document.getElementById('ldSave').addEventListener('click', function () {
    var name = document.getElementById('ldName').value.trim();
    var company = document.getElementById('ldCompany').value.trim();
    if (!name || !company) { showToast('Name and company are required.'); return; }
    var payload = {
      name: name, company: company,
      status: document.getElementById('ldStatus').value,
      value: Number(document.getElementById('ldValue').value) || 0,
      source: document.getElementById('ldSource').value.trim() || 'Manual entry',
      lastContacted: document.getElementById('ldLastContacted').value.trim() || null
    };
    var btn = document.getElementById('ldSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
    fetch('/api/accounts/' + accountId + '/leads/' + currentLeadId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Save changes';
        if (!r.ok) { showToast(r.d.error); return; }
        leadDetailModal.classList.remove('show');
        showToast('Lead updated.');
        loadAccount();
      });
  });

  // ---- tasks & reminders ----
  function completeTask(taskId) {
    fetch('/api/accounts/' + accountId + '/tasks/' + taskId + '/complete', { method: 'POST' })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { showToast(r.d.error); return; }
        showToast('Marked done.');
        loadAccount();
      });
  }

  var taskModal = document.getElementById('taskModal');
  var pendingAssigneeId = null;

  function openTaskModal(assigneeId, name, kind) {
    pendingAssigneeId = assigneeId;
    document.getElementById('taskAssigneeName').textContent = name;
    document.getElementById('taskKind').value = kind || 'task';
    document.getElementById('taskModalTitle').textContent = kind === 'reminder' ? 'Send reminder' : 'Assign task';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDue').value = '';
    taskModal.classList.add('show');
  }

  document.getElementById('taskModalClose').addEventListener('click', function () { taskModal.classList.remove('show'); });
  taskModal.addEventListener('click', function (e) { if (e.target === taskModal) taskModal.classList.remove('show'); });
  document.getElementById('taskKind').addEventListener('change', function () {
    document.getElementById('taskModalTitle').textContent = this.value === 'reminder' ? 'Send reminder' : 'Assign task';
  });
  document.getElementById('taskSubmit').addEventListener('click', function () {
    var title = document.getElementById('taskTitle').value.trim();
    if (!title) { showToast('Add a title first.'); return; }
    var payload = {
      assigneeId: pendingAssigneeId,
      title: title,
      kind: document.getElementById('taskKind').value,
      dueAt: document.getElementById('taskDue').value || null
    };
    var btn = document.getElementById('taskSubmit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending...';
    fetch('/api/accounts/' + accountId + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Send';
        if (!r.ok) { showToast(r.d.error); return; }
        taskModal.classList.remove('show');
        showToast(payload.kind === 'reminder' ? 'Reminder sent.' : 'Task assigned.');
        loadAccount();
      });
  });

  // ---- team: avatars, "+ New user" modal, user detail modal ----
  var AVATAR_COLORS = ['#22d3ee', '#7c5cff', '#2dffb0', '#ff3ec8', '#ffb84d', '#5c9aff'];
  function initials(name) {
    var parts = (name || '?').trim().split(/\s+/);
    return ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
  }
  function avatarColor(name) {
    var sum = 0;
    for (var i = 0; i < (name || '').length; i++) sum += name.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
  }
  function roleSlug(role) {
    return (role || 'user').toLowerCase().replace(/\s+/g, '-');
  }

  var addUserModal = document.getElementById('addUserModal');
  document.getElementById('newUserBtn').addEventListener('click', function () {
    if (document.getElementById('newUserBtn').disabled) return;
    ['newName', 'newUsername', 'newPassword'].forEach(function (fid) { document.getElementById(fid).value = ''; });
    addUserModal.classList.add('show');
  });
  document.getElementById('addUserModalClose').addEventListener('click', function () { addUserModal.classList.remove('show'); });
  addUserModal.addEventListener('click', function (e) { if (e.target === addUserModal) addUserModal.classList.remove('show'); });
  document.getElementById('addUserBtn').addEventListener('click', function () {
    var name = document.getElementById('newName').value.trim();
    var username = document.getElementById('newUsername').value.trim();
    var password = document.getElementById('newPassword').value;
    if (!name || !username || !password) { showToast('Fill in all fields.'); return; }
    var btn = document.getElementById('addUserBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Adding...';
    fetch('/api/accounts/' + accountId + '/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, username: username, password: password })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = '+ Add user';
        if (!r.ok) { showToast(r.d.error); return; }
        addUserModal.classList.remove('show');
        showToast('User added.');
        loadAccount();
      });
  });

  var userDetailModal = document.getElementById('userDetailModal');
  var currentUserId = null;

  function openUserDetail(memberId) {
    if (!currentData) return;
    var m = currentData.team.filter(function (x) { return x.id === memberId; })[0];
    if (!m) return;
    currentUserId = memberId;

    document.getElementById('udName').textContent = m.name + (m.isPrimary ? ' (Primary)' : '');
    document.getElementById('udUsername').textContent = m.username;
    document.getElementById('udNewPassword').value = '';

    document.getElementById('udRole').innerHTML = '<span class="role-tag role-tag-' + roleSlug(m.role) + '">' + (m.role || 'User') + '</span>';

    document.getElementById('udStats').innerHTML =
      metricCard('Deals won', m.dealsWon || 0, 'mint') +
      metricCard('Revenue brought in', '$' + (m.revenue || 0).toLocaleString(), 'mint') +
      metricCard('Actions run', m.actionsCount || 0);

    var memberTasks = (currentData.tasks || []).filter(function (t) { return t.assigneeId === memberId; });
    document.getElementById('udTasks').innerHTML = memberTasks.length
      ? memberTasks.map(function (t) {
          var overdue = t.status === 'pending' && t.dueAt && t.dueAt < Date.now();
          return '<div class="task-pill' + (t.status === 'done' ? ' done' : '') + '">' +
            '<span><span class="task-kind">' + (t.kind === 'reminder' ? 'REMINDER' : 'TASK') + '</span>' + t.title +
            (overdue ? ' <span style="color:var(--warn);">(overdue)</span>' : '') +
            (t.dueAt ? ' · due ' + fmtDate(t.dueAt) : '') + '</span>' +
            (t.status === 'pending' ? '<button class="task-done-btn" data-complete-task="' + t.id + '">Mark done</button>' : '<span>✓</span>') +
            '</div>';
        }).join('')
      : '<div class="empty-note">No tasks assigned yet.</div>';
    document.querySelectorAll('#udTasks [data-complete-task]').forEach(function (btn) {
      btn.addEventListener('click', function () { completeTask(btn.getAttribute('data-complete-task')); });
    });

    var assignRow = document.getElementById('udAssignTask').parentElement;
    assignRow.style.display = m.isPrimary ? 'none' : '';

    userDetailModal.classList.add('show');
  }

  document.getElementById('udClose').addEventListener('click', function () { userDetailModal.classList.remove('show'); });
  userDetailModal.addEventListener('click', function (e) { if (e.target === userDetailModal) userDetailModal.classList.remove('show'); });

  document.getElementById('udResetBtn').addEventListener('click', function () {
    var newPassword = document.getElementById('udNewPassword').value;
    if (!newPassword || newPassword.length < 6) { showToast('New password must be at least 6 characters.'); return; }
    var btn = document.getElementById('udResetBtn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    fetch('/api/accounts/' + accountId + '/team/' + currentUserId + '/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: newPassword })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.textContent = 'Reset';
        if (!r.ok) { showToast(r.d.error); return; }
        document.getElementById('udNewPassword').value = '';
        showToast('Password reset.');
      });
  });

  document.getElementById('udAssignTask').addEventListener('click', function () {
    var m = currentData.team.filter(function (x) { return x.id === currentUserId; })[0];
    if (!m) return;
    userDetailModal.classList.remove('show');
    openTaskModal(m.id, m.name, 'task');
  });
  document.getElementById('udAssignRemind').addEventListener('click', function () {
    var m = currentData.team.filter(function (x) { return x.id === currentUserId; })[0];
    if (!m) return;
    userDetailModal.classList.remove('show');
    openTaskModal(m.id, m.name, 'reminder');
  });

  function renderMyTasks(data) {
    var panel = document.getElementById('myTasksPanel');
    var list = data.myTasks || [];
    if (!list.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    var pending = list.filter(function (t) { return t.status === 'pending'; }).length;
    document.getElementById('myTasksSub').textContent = pending + ' open';
    document.getElementById('myTasksList').innerHTML = list.map(function (t) {
      return '<div class="my-task-row">' +
        '<div><span class="kind-tag">' + (t.kind === 'reminder' ? 'Reminder' : 'Task') + '</span>' +
        '<span' + (t.status === 'done' ? ' style="opacity:.5;text-decoration:line-through;"' : '') + '>' + t.title + '</span>' +
        '<div class="meta">From ' + t.createdBy + (t.dueAt ? ' · due ' + fmtDate(t.dueAt) : '') + '</div></div>' +
        (t.status === 'pending'
          ? '<button class="team-task-btn" data-complete-task="' + t.id + '">Mark done</button>'
          : '<span style="color:var(--mint);font-size:11px;">✓ Done</span>') +
        '</div>';
    }).join('');
  }

  function renderInaFeed(data) {
    var feed = document.getElementById('inaFeed');
    var inaItems = data.activity.filter(function (item) { return /^Ina /.test(item.text); });
    feed.innerHTML = inaItems.map(function (item) {
      return '<div class="ina-bubble">' + item.text + '<div class="when">' + timeAgo(item.at) + (item.actor ? ' · run by ' + item.actor : '') + '</div></div>';
    }).join('') || '<div class="empty-note">Ina hasn\'t run anything yet — try an automation.</div>';
  }

  // ---- Real Estate CRM module ----
  var initialViewSet = false;

  function reMoney(n) {
    if (n === null || n === undefined || n === '') return '—';
    var num = Number(n);
    if (!num) return '₹0';
    if (num >= 10000000) return '₹' + (num / 10000000).toFixed(2) + 'Cr';
    if (num >= 100000) return '₹' + (num / 100000).toFixed(1) + 'L';
    return '₹' + num.toLocaleString('en-IN');
  }

  function reStatusClass(status) {
    return 'status-' + String(status || '').replace(/\s+/g, '');
  }

  var PENCIL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>';

  function renderRealEstate(data) {
    var viewerIsPrimary = !!data.viewerIsPrimary;

    var expired = data.expiresAt && data.expiresAt < Date.now();
    document.getElementById('reLicenseBar').innerHTML =
      '<b style="color:var(--text);">' + (data.typeLabel || 'Platform') + '</b>' +
      ' &nbsp;·&nbsp; License <span style="font-family:\'JetBrains Mono\',monospace;color:var(--cyan);">' + (data.licenseNumber || '—') + '</span>' +
      ' &nbsp;·&nbsp; Started ' + fmtDate(data.startsAt) +
      ' &nbsp;·&nbsp; <span style="color:' + (expired ? 'var(--warn)' : 'var(--faint)') + ';">' + (expired ? 'Expired ' : 'Expires ') + fmtDate(data.expiresAt) + '</span>' +
      (data.licenseTermMonths ? ' (' + data.licenseTermMonths + '-month term)' : '');

    var dash = data.dashboard || {};
    document.getElementById('reDashCards').innerHTML =
      metricCard('New leads today', dash.newLeadsToday || 0) +
      metricCard('Unassigned', dash.unassigned || 0, dash.unassigned > 0 ? 'warn' : '') +
      metricCard('Upcoming site visits', dash.siteVisits || 0) +
      metricCard('Active brokers', dash.activeBrokers || 0) +
      metricCard('Credits used / limit', (data.creditsUsed || 0).toLocaleString() + ' / ' + (data.creditLimit || 0).toLocaleString());

    document.getElementById('reActionsRow').innerHTML = data.actionsAvailable.map(function (a, i) {
      return '<button class="action-btn' + (i === 0 ? ' primary' : '') + '" data-re-action="' + a.key + '"' + (data.status === 'suspended' ? ' disabled' : '') + '>' + a.icon + ' ' + a.label + '</button>';
    }).join('');

    if (viewerIsPrimary) {
      document.getElementById('reActivityList').innerHTML = data.activity.map(function (item) {
        return '<div class="activity-item">' + item.text + '<div class="when">' + timeAgo(item.at) + (item.actor ? ' · ' + item.actor : '') + '</div></div>';
      }).join('') || '<div class="empty-note">No activity yet.</div>';
    } else {
      document.getElementById('reActivityList').innerHTML = '<div class="empty-note">Activity is visible to the primary admin.</div>';
    }

    var inaItems = data.activity.filter(function (item) { return /^Ina /.test(item.text); });
    document.getElementById('reInaFeed').innerHTML = inaItems.map(function (item) {
      return '<div class="ina-bubble">' + item.text + '<div class="when">' + timeAgo(item.at) + (item.actor ? ' · run by ' + item.actor : '') + '</div></div>';
    }).join('') || '<div class="empty-note">Ina hasn\'t run anything yet — try an automation.</div>';

    renderReCharts(data);

    populateReFilterOptions(data);
    renderLeadsTable();
    renderBrokersList();
    renderInventoryTable();
    renderAccountingTable();
    renderVisitsTable();
    renderWaLeadsPanel();

    document.querySelectorAll('[data-re-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-re-action');
        var originalHtml = btn.innerHTML;
        document.querySelectorAll('[data-re-action]').forEach(function (b) { b.disabled = true; });
        btn.innerHTML = '<span class="spinner"></span> Running...';
        fetch('/api/accounts/' + accountId + '/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: key })
        }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
          .then(function (r) {
            if (!r.ok) {
              document.querySelectorAll('[data-re-action]').forEach(function (b) { b.disabled = false; });
              btn.innerHTML = originalHtml;
              showToast(r.d.error);
              return;
            }
            showToast(r.d.summary + ' (' + r.d.creditsSpent + ' credits)');
            loadAccount();
          });
      });
    });
  }

  // ---- Real Estate CRM: table toolbar plumbing (options, filters, renders) ----
  function uniqueSorted(arr) {
    var seen = {}; var out = [];
    (arr || []).forEach(function (v) { if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }

  function fillFilterOptionsPairs(selId, pairs) {
    var el = document.getElementById(selId);
    if (!el || !el.options.length) return;
    var current = el.value;
    var firstOption = el.options[0].outerHTML;
    el.innerHTML = firstOption + pairs.map(function (p) { return '<option value="' + p.value + '">' + p.label + '</option>'; }).join('');
    el.value = pairs.some(function (p) { return p.value === current; }) ? current : '';
  }

  function fillFilterOptionsPlain(selId, values) {
    fillFilterOptionsPairs(selId, values.map(function (v) { return { value: v, label: v }; }));
  }

  function populateReFilterOptions(data) {
    fillFilterOptionsPlain('reLeadsFilterStatus', RE_LEAD_STATUSES);
    fillFilterOptionsPairs('reLeadsFilterBroker', (data.brokers || []).map(function (b) { return { value: b.id, label: b.name }; }));
    fillFilterOptionsPlain('reLeadsFilterSource', RE_LEAD_SOURCES);

    fillFilterOptionsPlain('reBrokersFilterStatus', RE_BROKER_STATUSES);
    fillFilterOptionsPlain('reBrokersFilterZone', uniqueSorted(data.brokers.map(function (b) { return b.zone; })));

    fillFilterOptionsPlain('reInventoryFilterStatus', RE_INVENTORY_STATUSES);
    fillFilterOptionsPlain('reInventoryFilterType', uniqueSorted(data.inventory.map(function (i) { return i.type; })));

    fillFilterOptionsPlain('reAccountingFilterStatus', RE_ACCOUNTING_STATUSES);
    fillFilterOptionsPlain('reAccountingFilterType', uniqueSorted(data.accounting.map(function (t) { return t.type; })));
    fillFilterOptionsPlain('reAccountingFilterMode', uniqueSorted(data.accounting.map(function (t) { return t.paymentMode; })));

    fillFilterOptionsPlain('reVisitsFilterStatus', RE_SITE_VISIT_STATUSES);
    fillFilterOptionsPairs('reVisitsFilterBroker', (data.brokers || []).map(function (b) { return { value: b.id, label: b.name }; }));

    fillFilterOptionsPlain('reportsFilterZone', uniqueSorted(data.brokers.map(function (b) { return b.zone; })));
    fillFilterOptionsPlain('reportsFilterStatus', RE_BROKER_STATUSES);

    fillFilterOptionsPlain('waLeadsFilterInterest', uniqueSorted(data.leads.map(function (l) { return l.propertyInterest; })));
    fillFilterOptionsPlain('waLeadsFilterStatus', RE_LEAD_STATUSES);
  }

  // -- leads table --
  function reLeadsFiltered() {
    if (!currentData) return [];
    return ttApply('reLeads', currentData.leads, ['name', 'phone', 'email', 'propertyInterest'], {
      status: function (l, v) { return l.status === v; },
      broker: function (l, v) { return l.brokerId === v; },
      source: function (l, v) { return l.source === v; },
      budgetMin: function (l, v) { return (l.budget || 0) >= Number(v); },
      budgetMax: function (l, v) { return (l.budget || 0) <= Number(v); },
      dateFrom: function (l, v) { return !!l.dateReceived && l.dateReceived >= v; },
      dateTo: function (l, v) { return !!l.dateReceived && l.dateReceived <= v; }
    });
  }
  ttVisibleIds.reLeads = function () { return reLeadsFiltered().map(function (l) { return l.id; }); };

  function renderLeadsTable() {
    if (!currentData) return;
    var filtered = reLeadsFiltered();
    var active = ttToolbarActive('reLeads');
    document.getElementById('reLeadsSub').textContent = filtered.length + (active ? ' of ' + currentData.leads.length : '') + (filtered.length === 1 ? ' lead' : ' leads');
    document.getElementById('reLeadsSelectionBar').innerHTML = ttSelectionBarHTML('reLeads', 'lead');
    document.getElementById('reLeadsHeaderCheck').innerHTML = ttHeaderCheckboxHTML('reLeads');
    document.getElementById('reLeadsBody').innerHTML = filtered.map(function (l) {
      return '<tr><td class="tt-check-col">' + ttRowCheckboxHTML('reLeads', l.id) + '</td>' +
        '<td><a href="#" class="link-btn" data-open-lead="' + l.id + '" style="color:var(--text);font-weight:600;">' + l.name + '</a></td>' +
        '<td>' + sourceBadge(l.source) + '</td>' +
        '<td>' + (l.propertyInterest || '—') + '</td>' +
        '<td>' + (l.broker || '<span style="color:var(--warn);">Unassigned</span>') + '</td>' +
        '<td><span class="status-pill ' + reStatusClass(l.status) + '">' + l.status + '</span></td>' +
        '<td>' + (l.nextFollowup || '—') + '</td>' +
        '<td style="text-align:right;"><button class="icon-btn" title="Edit lead" data-re-edit-lead="' + l.id + '">' + PENCIL_ICON + '</button></td></tr>';
    }).join('') || '<tr><td colspan="8" class="empty-note">' + (active ? 'No leads match your search/filters.' : 'No leads yet.') + '</td></tr>';
    document.querySelectorAll('[data-re-edit-lead]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReLeadModal(btn.getAttribute('data-re-edit-lead')); });
    });
    document.querySelectorAll('[data-open-lead]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openReLeadDetail(a.getAttribute('data-open-lead')); });
    });
    ttApplyIndeterminate();
  }
  ttRenderFns.reLeads = renderLeadsTable;

  // -- brokers list --
  function reBrokersFiltered() {
    if (!currentData) return [];
    return ttApply('reBrokers', currentData.brokers, ['name', 'zone'], {
      status: function (b, v) { return b.status === v; },
      zone: function (b, v) { return b.zone === v; }
    });
  }
  ttVisibleIds.reBrokers = function () { return reBrokersFiltered().map(function (b) { return b.id; }); };

  function renderBrokersList() {
    if (!currentData) return;
    var filtered = reBrokersFiltered();
    var active = ttToolbarActive('reBrokers');
    document.getElementById('reBrokersSub').textContent = filtered.length + (active ? ' of ' + currentData.brokers.length : '') + (filtered.length === 1 ? ' broker' : ' brokers');
    document.getElementById('reBrokersSelectionBar').innerHTML = ttSelectionBarHTML('reBrokers', 'broker');
    document.getElementById('reBrokersList').innerHTML = filtered.map(function (b) {
      var pct = Math.round((b.achievedPct || 0) * 100);
      var fillClass = pct === 0 ? 'zero' : pct < 50 ? 'low' : '';
      return '<div class="re-broker-card has-select">' + ttRowCheckboxHTML('reBrokers', b.id) +
        '<div class="row"><span class="name"><a href="#" data-open-broker="' + b.id + '" style="color:var(--text);">' + b.name + '</a></span>' +
        '<span class="meta" style="display:flex;align-items:center;gap:8px;">' + (b.zone || '') + ' <span class="status-pill ' + reStatusClass(b.status) + '">' + b.status + '</span> <button class="icon-btn" title="Edit broker" data-re-edit-broker="' + b.id + '">' + PENCIL_ICON + '</button></span></div>' +
        '<p class="target">Active leads: ' + (b.activeLeads || 0) + ' · Closed deals: ' + (b.closedDeals || 0) + ' · Target ' + reMoney(b.salesTarget) + ' · Achieved ' + reMoney(b.revenueAchieved) + '</p>' +
        '<div class="re-progress-track"><div class="re-progress-fill ' + fillClass + '" style="width:' + Math.min(pct, 100) + '%;"></div></div>' +
        '<p class="re-progress-pct">' + pct + '% of target</p>' +
        '</div>';
    }).join('') || '<div class="empty-note">' + (active ? 'No brokers match your search/filters.' : 'No brokers yet.') + '</div>';
    document.querySelectorAll('[data-re-edit-broker]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReBrokerModal(btn.getAttribute('data-re-edit-broker')); });
    });
    document.querySelectorAll('[data-open-broker]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openReBrokerDetail(a.getAttribute('data-open-broker')); });
    });
    var headerCb = document.getElementById('reBrokersHeaderCheck');
    if (headerCb) {
      var ids = ttVisibleIds.reBrokers();
      var state = ttState('reBrokers');
      var allSel = ids.length > 0 && ids.every(function (id) { return state.selected.has(id); });
      headerCb.checked = allSel;
      headerCb.indeterminate = !allSel && ids.some(function (id) { return state.selected.has(id); });
    }
    ttApplyIndeterminate();
  }
  ttRenderFns.reBrokers = renderBrokersList;

  // -- inventory table --
  function reInventoryFiltered() {
    if (!currentData) return [];
    return ttApply('reInventory', currentData.inventory, ['projectName', 'unitNo', 'location'], {
      status: function (i, v) { return i.status === v; },
      type: function (i, v) { return i.type === v; },
      priceMin: function (i, v) { return (i.price || 0) >= Number(v); },
      priceMax: function (i, v) { return (i.price || 0) <= Number(v); },
      areaMin: function (i, v) { return (i.areaSqft || 0) >= Number(v); },
      areaMax: function (i, v) { return (i.areaSqft || 0) <= Number(v); }
    });
  }
  ttVisibleIds.reInventory = function () { return reInventoryFiltered().map(function (i) { return i.id; }); };

  function renderInventoryTable() {
    if (!currentData) return;
    var filtered = reInventoryFiltered();
    var active = ttToolbarActive('reInventory');
    document.getElementById('reInventorySub').textContent = filtered.length + (active ? ' of ' + currentData.inventory.length : '') + (filtered.length === 1 ? ' unit' : ' units');
    document.getElementById('reInventorySelectionBar').innerHTML = ttSelectionBarHTML('reInventory', 'unit');
    document.getElementById('reInventoryHeaderCheck').innerHTML = ttHeaderCheckboxHTML('reInventory');
    document.getElementById('reInventoryBody').innerHTML = filtered.map(function (i) {
      return '<tr><td class="tt-check-col">' + ttRowCheckboxHTML('reInventory', i.id) + '</td>' +
        '<td><a href="#" class="link-btn" data-open-inv="' + i.id + '" style="color:var(--text);font-weight:600;">' + i.projectName + (i.unitNo ? ' ' + i.unitNo : '') + '</a></td><td>' + (i.type || '—') + '</td>' +
        '<td>' + (i.areaSqft ? Number(i.areaSqft).toLocaleString() + ' sqft' : '—') + '</td>' +
        '<td>' + reMoney(i.price) + '</td>' +
        '<td><span class="status-pill ' + reStatusClass(i.status) + '">' + i.status + '</span></td>' +
        '<td>' + (i.location || '—') + '</td>' +
        '<td style="text-align:right;"><button class="icon-btn" title="Edit unit" data-re-edit-inv="' + i.id + '">' + PENCIL_ICON + '</button></td></tr>';
    }).join('') || '<tr><td colspan="8" class="empty-note">' + (active ? 'No units match your search/filters.' : 'No inventory yet.') + '</td></tr>';
    document.querySelectorAll('[data-re-edit-inv]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReInventoryModal(btn.getAttribute('data-re-edit-inv')); });
    });
    document.querySelectorAll('[data-open-inv]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openReInventoryDetail(a.getAttribute('data-open-inv')); });
    });
    ttApplyIndeterminate();
  }
  ttRenderFns.reInventory = renderInventoryTable;

  // -- accounting table --
  function reAccountingFiltered() {
    if (!currentData) return [];
    return ttApply('reAccounting', currentData.accounting, ['clientName', 'property', 'brokerName'], {
      status: function (t, v) { return t.status === v; },
      type: function (t, v) { return t.type === v; },
      mode: function (t, v) { return t.paymentMode === v; },
      amountMin: function (t, v) { return (t.amount || 0) >= Number(v); },
      amountMax: function (t, v) { return (t.amount || 0) <= Number(v); },
      dateFrom: function (t, v) { return !!t.date && t.date >= v; },
      dateTo: function (t, v) { return !!t.date && t.date <= v; }
    });
  }
  ttVisibleIds.reAccounting = function () { return reAccountingFiltered().map(function (t) { return t.id; }); };

  function renderAccountingTable() {
    if (!currentData) return;
    var filtered = reAccountingFiltered();
    var active = ttToolbarActive('reAccounting');
    document.getElementById('reAccountingSub').textContent = filtered.length + (active ? ' of ' + currentData.accounting.length : '') + (filtered.length === 1 ? ' transaction' : ' transactions');
    document.getElementById('reAccountingSelectionBar').innerHTML = ttSelectionBarHTML('reAccounting', 'transaction');
    document.getElementById('reAccountingHeaderCheck').innerHTML = ttHeaderCheckboxHTML('reAccounting');
    document.getElementById('reAccountingBody').innerHTML = filtered.map(function (t) {
      return '<tr><td class="tt-check-col">' + ttRowCheckboxHTML('reAccounting', t.id) + '</td>' +
        '<td>' + (t.clientName || '—') + '</td><td>' + (t.property || '—') + '</td><td>' + (t.type || '—') + '</td>' +
        '<td>' + reMoney(t.amount) + '</td><td>' + (t.brokerName || '—') + '</td><td>' + (t.paymentMode || '—') + '</td>' +
        '<td><span class="status-pill ' + reStatusClass(t.status) + '">' + t.status + '</span></td>' +
        '<td style="text-align:right;"><button class="icon-btn" title="Edit transaction" data-re-edit-txn="' + t.id + '">' + PENCIL_ICON + '</button></td></tr>';
    }).join('') || '<tr><td colspan="9" class="empty-note">' + (active ? 'No transactions match your search/filters.' : 'No transactions yet.') + '</td></tr>';
    document.querySelectorAll('[data-re-edit-txn]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReAccountingModal(btn.getAttribute('data-re-edit-txn')); });
    });
    ttApplyIndeterminate();
  }
  ttRenderFns.reAccounting = renderAccountingTable;

  // -- site visits table --
  function reVisitsFiltered() {
    if (!currentData) return [];
    return ttApply('reVisits', currentData.siteVisits || [], ['leadName', 'brokerName', 'propertyLabel'], {
      status: function (v, val) { return v.status === val; },
      broker: function (v, val) { return v.brokerId === val; },
      dateFrom: function (v, val) { return !!v.scheduledAt && new Date(v.scheduledAt).toISOString().slice(0, 10) >= val; },
      dateTo: function (v, val) { return !!v.scheduledAt && new Date(v.scheduledAt).toISOString().slice(0, 10) <= val; }
    });
  }
  ttVisibleIds.reVisits = function () { return reVisitsFiltered().map(function (v) { return v.id; }); };

  function renderVisitsTable() {
    if (!currentData) return;
    var filtered = reVisitsFiltered();
    var active = ttToolbarActive('reVisits');
    var total = (currentData.siteVisits || []).length;
    document.getElementById('reVisitsSub').textContent = filtered.length + (active ? ' of ' + total : '') + (filtered.length === 1 ? ' visit' : ' visits');
    document.getElementById('reVisitsSelectionBar').innerHTML = ttSelectionBarHTML('reVisits', 'visit');
    document.getElementById('reVisitsHeaderCheck').innerHTML = ttHeaderCheckboxHTML('reVisits');
    document.getElementById('reVisitsBody').innerHTML = filtered.map(function (v) {
      return '<tr><td class="tt-check-col">' + ttRowCheckboxHTML('reVisits', v.id) + '</td>' +
        '<td>' + (v.leadId ? '<a href="#" class="link-btn" data-open-lead="' + v.leadId + '" style="color:var(--text);font-weight:600;">' + v.leadName + '</a>' : (v.leadName || '—')) + '</td>' +
        '<td>' + (v.propertyLabel || '—') + '</td>' +
        '<td>' + (v.brokerName || '<span style="color:var(--warn);">Unassigned</span>') + '</td>' +
        '<td>' + fmtDateTime(v.scheduledAt) + '</td>' +
        '<td><span class="status-pill ' + reStatusClass(v.status) + '">' + v.status + '</span></td>' +
        '<td>' + (v.notes || '—') + '</td>' +
        '<td style="text-align:right;"><button class="icon-btn" title="Edit visit" data-re-edit-visit="' + v.id + '">' + PENCIL_ICON + '</button></td></tr>';
    }).join('') || '<tr><td colspan="8" class="empty-note">' + (active ? 'No visits match your search/filters.' : 'No site visits scheduled yet.') + '</td></tr>';
    document.querySelectorAll('[data-re-edit-visit]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReVisitModal(btn.getAttribute('data-re-edit-visit')); });
    });
    document.querySelectorAll('#reVisitsBody [data-open-lead]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openReLeadDetail(a.getAttribute('data-open-lead')); });
    });
    ttApplyIndeterminate();
  }
  ttRenderFns.reVisits = renderVisitsTable;

  // -- team table (shared by Sales and Real Estate) --
  function reTeamFiltered() {
    if (!currentData || !currentData.team) return [];
    return ttApply('team', currentData.team, ['name', 'username'], {
      role: function (m, v) { return (m.role || 'User') === v; }
    });
  }
  ttVisibleIds.team = function () { return reTeamFiltered().map(function (m) { return m.id; }); };

  function renderTeamTable() {
    if (!currentData || !currentData.team) return;
    var isSuperAdminViewer = currentData.viewerRole === 'super_admin';
    var filtered = reTeamFiltered();
    var active = ttToolbarActive('team');
    document.getElementById('teamSub').textContent = filtered.length + (active ? ' of ' + currentData.team.length : '') + (isSuperAdminViewer ? ' users' : ' / 3 users');
    document.getElementById('teamSelectionBar').innerHTML = ttSelectionBarHTML('team', 'user');
    document.getElementById('teamHeaderCheck').innerHTML = ttHeaderCheckboxHTML('team');
    document.getElementById('teamList').innerHTML = filtered.map(function (m) {
      return '<tr><td class="tt-check-col">' + ttRowCheckboxHTML('team', m.id) + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:10px;">' +
          '<span class="avatar-circle" style="background:' + avatarColor(m.name) + ';">' + initials(m.name) + '</span>' +
          '<span>' + m.name + '<span class="role-tag role-tag-' + roleSlug(m.role) + '">' + (m.role || 'Sales Rep') + '</span></span>' +
        '</div></td>' +
        '<td style="color:var(--faint);">' + m.username + '</td>' +
        '<td style="text-align:right;"><button class="link-btn" data-view-user="' + m.id + '">View →</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="4" class="empty-note">' + (active ? 'No teammates match your search/filters.' : 'No teammates yet.') + '</td></tr>';
    document.querySelectorAll('[data-view-user]').forEach(function (btn) {
      btn.addEventListener('click', function () { openUserDetail(btn.getAttribute('data-view-user')); });
    });
    ttApplyIndeterminate();
  }
  ttRenderFns.team = renderTeamTable;

  // -- toolbar control binding (once — element ids are static in the DOM) --
  function ttBindSearch(elId, name) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('input', function () { ttState(name).search = el.value; ttRerender(name); });
  }
  function ttBindFilter(elId, name, key) {
    var el = document.getElementById(elId);
    if (!el) return;
    var evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, function () { ttState(name).filters[key] = el.value; ttRerender(name); });
  }
  function ttBindReset(elId, name, fieldIds) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('click', function () {
      var state = ttState(name);
      state.search = ''; state.filters = {};
      fieldIds.forEach(function (id) { var f = document.getElementById(id); if (f) f.value = ''; });
      ttRerender(name);
    });
  }

  function bindReTableToolbars() {
    ttBindSearch('reLeadsSearch', 'reLeads');
    ttBindFilter('reLeadsFilterStatus', 'reLeads', 'status');
    ttBindFilter('reLeadsFilterBroker', 'reLeads', 'broker');
    ttBindFilter('reLeadsFilterSource', 'reLeads', 'source');
    ttBindFilter('reLeadsFilterBudgetMin', 'reLeads', 'budgetMin');
    ttBindFilter('reLeadsFilterBudgetMax', 'reLeads', 'budgetMax');
    ttBindFilter('reLeadsFilterDateFrom', 'reLeads', 'dateFrom');
    ttBindFilter('reLeadsFilterDateTo', 'reLeads', 'dateTo');
    ttBindReset('reLeadsFilterReset', 'reLeads', ['reLeadsSearch', 'reLeadsFilterStatus', 'reLeadsFilterBroker', 'reLeadsFilterSource', 'reLeadsFilterBudgetMin', 'reLeadsFilterBudgetMax', 'reLeadsFilterDateFrom', 'reLeadsFilterDateTo']);

    ttBindSearch('waLeadsSearch', 'waLeads');
    ttBindFilter('waLeadsFilterInterest', 'waLeads', 'interest');
    ttBindFilter('waLeadsFilterStatus', 'waLeads', 'status');
    ttBindReset('waLeadsFilterReset', 'waLeads', ['waLeadsSearch', 'waLeadsFilterInterest', 'waLeadsFilterStatus']);

    ttBindSearch('reBrokersSearch', 'reBrokers');
    ttBindFilter('reBrokersFilterStatus', 'reBrokers', 'status');
    ttBindFilter('reBrokersFilterZone', 'reBrokers', 'zone');
    ttBindReset('reBrokersFilterReset', 'reBrokers', ['reBrokersSearch', 'reBrokersFilterStatus', 'reBrokersFilterZone']);

    ttBindSearch('reInventorySearch', 'reInventory');
    ttBindFilter('reInventoryFilterStatus', 'reInventory', 'status');
    ttBindFilter('reInventoryFilterType', 'reInventory', 'type');
    ttBindFilter('reInventoryFilterPriceMin', 'reInventory', 'priceMin');
    ttBindFilter('reInventoryFilterPriceMax', 'reInventory', 'priceMax');
    ttBindFilter('reInventoryFilterAreaMin', 'reInventory', 'areaMin');
    ttBindFilter('reInventoryFilterAreaMax', 'reInventory', 'areaMax');
    ttBindReset('reInventoryFilterReset', 'reInventory', ['reInventorySearch', 'reInventoryFilterStatus', 'reInventoryFilterType', 'reInventoryFilterPriceMin', 'reInventoryFilterPriceMax', 'reInventoryFilterAreaMin', 'reInventoryFilterAreaMax']);

    ttBindSearch('reAccountingSearch', 'reAccounting');
    ttBindFilter('reAccountingFilterStatus', 'reAccounting', 'status');
    ttBindFilter('reAccountingFilterType', 'reAccounting', 'type');
    ttBindFilter('reAccountingFilterMode', 'reAccounting', 'mode');
    ttBindFilter('reAccountingFilterAmountMin', 'reAccounting', 'amountMin');
    ttBindFilter('reAccountingFilterAmountMax', 'reAccounting', 'amountMax');
    ttBindFilter('reAccountingFilterDateFrom', 'reAccounting', 'dateFrom');
    ttBindFilter('reAccountingFilterDateTo', 'reAccounting', 'dateTo');
    ttBindReset('reAccountingFilterReset', 'reAccounting', ['reAccountingSearch', 'reAccountingFilterStatus', 'reAccountingFilterType', 'reAccountingFilterMode', 'reAccountingFilterAmountMin', 'reAccountingFilterAmountMax', 'reAccountingFilterDateFrom', 'reAccountingFilterDateTo']);

    ttBindSearch('reVisitsSearch', 'reVisits');
    ttBindFilter('reVisitsFilterStatus', 'reVisits', 'status');
    ttBindFilter('reVisitsFilterBroker', 'reVisits', 'broker');
    ttBindFilter('reVisitsFilterDateFrom', 'reVisits', 'dateFrom');
    ttBindFilter('reVisitsFilterDateTo', 'reVisits', 'dateTo');
    ttBindReset('reVisitsFilterReset', 'reVisits', ['reVisitsSearch', 'reVisitsFilterStatus', 'reVisitsFilterBroker', 'reVisitsFilterDateFrom', 'reVisitsFilterDateTo']);

    ttBindSearch('teamSearch', 'team');
    ttBindFilter('teamFilterRole', 'team', 'role');
    ttBindReset('teamFilterReset', 'team', ['teamSearch', 'teamFilterRole']);

    ttBindSearch('reportsSearch', 'reports');
    ttBindFilter('reportsFilterZone', 'reports', 'zone');
    ttBindFilter('reportsFilterStatus', 'reports', 'status');
    ttBindReset('reportsFilterReset', 'reports', ['reportsSearch', 'reportsFilterZone', 'reportsFilterStatus']);
  }
  bindReTableToolbars();

  // ---- Real Estate CRM: monthly broker report ----
  var monthlyReportLoaded = false;
  var lastMonthlyReportData = null;

  function loadMonthlyReport() {
    if (!accountId) return;
    document.getElementById('reportsBody').innerHTML = '<tr><td colspan="10" class="empty-note"><span class="spinner"></span> Loading...</td></tr>';
    fetch('/api/accounts/' + accountId + '/re/monthly-report')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        lastMonthlyReportData = data;
        fillFilterOptionsPlain('reportsFilterZone', uniqueSorted((data.brokers || []).map(function (b) { return b.zone; })));
        renderMonthlyReport(data);
        monthlyReportLoaded = true;
      })
      .catch(function () { document.getElementById('reportsBody').innerHTML = '<tr><td colspan="10" class="empty-note">Could not load the report — try again.</td></tr>'; });
  }

  function reportsFiltered() {
    if (!lastMonthlyReportData) return [];
    return ttApply('reports', lastMonthlyReportData.brokers || [], ['name'], {
      zone: function (b, v) { return b.zone === v; },
      status: function (b, v) { return b.status === v; }
    });
  }

  function renderMonthlyReport(data) {
    document.getElementById('reportsMonthLabel').textContent = data.monthLabel || '';
    var t = data.totals || {};
    document.getElementById('reportsSummaryCards').innerHTML =
      metricCard('Total target', reMoney(t.target)) +
      metricCard('Total achieved (overall)', reMoney(t.achieved)) +
      metricCard('Collected this month', reMoney(t.collectionsThisMonth), 'mint') +
      metricCard('Deals closed this month', t.dealsThisMonth || 0) +
      metricCard('New leads this month', t.newLeadsThisMonth || 0) +
      metricCard('Top performer', data.topBrokerName || '—');

    renderMonthlyReportTable();
  }

  function renderMonthlyReportTable() {
    if (!lastMonthlyReportData) return;
    var brokers = reportsFiltered();
    var active = ttToolbarActive('reports');
    document.getElementById('reportsBody').innerHTML = brokers.map(function (b) {
      var pct = Math.round((b.achievedPct || 0) * 100);
      var convPct = Math.round((b.conversionRate || 0) * 100);
      return '<tr>' +
        '<td><a href="#" data-open-broker-report="' + b.brokerId + '" style="color:var(--text);font-weight:600;">' + b.name + '</a>' +
        '<div style="font-size:10.5px;color:var(--faint);margin-top:2px;">' + (b.status || '') + '</div></td>' +
        '<td>' + (b.zone || '—') + '</td>' +
        '<td>' + reMoney(b.target) + '</td>' +
        '<td>' + reMoney(b.achieved) + '<div style="font-size:10.5px;color:var(--faint);margin-top:2px;">' + pct + '% of target</div></td>' +
        '<td style="color:var(--mint);font-weight:600;">' + reMoney(b.collectionsThisMonth) + '</td>' +
        '<td>' + (b.dealsThisMonth || 0) + '</td>' +
        '<td>' + (b.newLeadsThisMonth || 0) + (b.closedThisMonth ? ' <span style="color:var(--faint);">(' + b.closedThisMonth + ' closed)</span>' : '') + '</td>' +
        '<td>' + (b.activeLeads || 0) + '</td>' +
        '<td>' + (b.closedDeals || 0) + '</td>' +
        '<td>' + convPct + '%</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="10" class="empty-note">' + (active ? 'No brokers match your search/filters.' : 'No brokers yet — add one from the Brokers tab.') + '</td></tr>';

    document.querySelectorAll('[data-open-broker-report]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        switchView('brokers');
        openReBrokerDetail(a.getAttribute('data-open-broker-report'));
      });
    });
  }
  ttRenderFns.reports = renderMonthlyReportTable;

  // ---- Real Estate CRM: WhatsApp integration tab ----
  function loadWhatsAppTab() {
    if (!accountId) return;
    activeWaChatLeadId = null;
    document.getElementById('waChatPanel').style.display = 'none';
    document.getElementById('waConvosPanel').style.display = '';
    document.getElementById('waSetupSub').textContent = 'Checking status…';
    document.getElementById('waConvosSub').textContent = '';
    document.getElementById('waConvosList').innerHTML = '<div class="empty-note"><span class="spinner"></span> Loading…</div>';

    fetch('/api/accounts/' + accountId + '/re/whatsapp/status')
      .then(function (res) { return res.json(); })
      .then(renderWaSetup)
      .catch(function () { document.getElementById('waSetupSub').textContent = 'Could not load status.'; });

    fetch('/api/accounts/' + accountId + '/re/whatsapp/conversations')
      .then(function (res) { return res.json(); })
      .then(renderWaConvos)
      .catch(function () { document.getElementById('waConvosList').innerHTML = '<div class="empty-note">Could not load conversations.</div>'; });

    renderWaLeadsPanel();
  }

  document.getElementById('waAddLeadBtn').addEventListener('click', function () { openReLeadModal(null); });

  document.getElementById('waSetupToggleBtn').addEventListener('click', function () {
    var body = document.getElementById('waSetupBody');
    var btn = document.getElementById('waSetupToggleBtn');
    var show = body.style.display === 'none';
    body.style.display = show ? '' : 'none';
    btn.textContent = show ? 'Hide setup' : 'Show setup';
  });

  // -- WhatsApp outreach: leads side panel (filter + multi-select + bulk send) --
  function waLeadsFiltered() {
    if (!currentData) return [];
    var withPhone = currentData.leads.filter(function (l) { return !!l.phone; });
    return ttApply('waLeads', withPhone, ['name', 'phone', 'propertyInterest'], {
      interest: function (l, v) { return l.propertyInterest === v; },
      status: function (l, v) { return l.status === v; }
    });
  }
  ttVisibleIds.waLeads = function () { return waLeadsFiltered().map(function (l) { return l.id; }); };

  function waLeadsSelectionBarHTML() {
    var n = ttState('waLeads').selected.size;
    if (!n) return '';
    return '<div class="tt-selection-bar show">' +
      '<span>' + n + ' lead' + (n === 1 ? '' : 's') + ' selected</span>' +
      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-secondary" type="button" id="waBulkSendBtn" style="padding:8px 10px;font-size:11px;">Send outreach template</button>' +
      '<button class="tt-reset" type="button" data-tt-clear="waLeads">Clear</button>' +
      '</div></div>';
  }

  function renderWaLeadsPanel() {
    if (!currentData) return;
    var filtered = waLeadsFiltered();
    var totalWithPhone = currentData.leads.filter(function (l) { return !!l.phone; }).length;
    var active = ttToolbarActive('waLeads');
    document.getElementById('waLeadsSub').textContent = filtered.length + (active ? ' of ' + totalWithPhone : '') + (filtered.length === 1 ? ' lead' : ' leads');
    document.getElementById('waLeadsSelectAllRow').innerHTML = '<label>' + ttHeaderCheckboxHTML('waLeads') + ' Select all</label>';
    document.getElementById('waLeadsSelectionBar').innerHTML = waLeadsSelectionBarHTML();
    document.getElementById('waLeadsList').innerHTML = filtered.map(function (l) {
      return '<div class="wa-lead-row">' + ttRowCheckboxHTML('waLeads', l.id) +
        '<div class="body" data-open-wa-panel-lead="' + l.id + '">' +
        '<div class="top"><strong>' + escapeHtmlWa(l.name) + '</strong><span class="phone">' + escapeHtmlWa(l.phone) + '</span></div>' +
        '<div class="interest">' + escapeHtmlWa(l.propertyInterest || 'No property interest on file') + '</div>' +
        '</div>' +
        '<button class="icon-btn" type="button" data-msg-wa-lead="' + l.id + '" title="Message ' + escapeHtmlWa(l.name) + '">' + WA_MSG_ICON + '</button>' +
        '</div>';
    }).join('') || '<div class="empty-note" style="padding:16px 4px;">' + (active ? 'No leads match your filters.' : 'No leads with a phone number yet.') + '</div>';
    ttApplyIndeterminate();

    document.querySelectorAll('[data-open-wa-panel-lead]').forEach(function (el) {
      el.addEventListener('click', function () {
        switchView('releads');
        openReLeadDetail(el.getAttribute('data-open-wa-panel-lead'));
      });
    });
    document.querySelectorAll('[data-msg-wa-lead]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openWaChat(el.getAttribute('data-msg-wa-lead'));
      });
    });
    var bulkBtn = document.getElementById('waBulkSendBtn');
    if (bulkBtn) bulkBtn.addEventListener('click', sendBulkOutreach);
  }
  var WA_MSG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  ttRenderFns.waLeads = renderWaLeadsPanel;

  function sendBulkOutreach() {
    var ids = Array.from(ttState('waLeads').selected);
    if (!ids.length) return;
    if (!window.confirm('Send the WhatsApp outreach template to ' + ids.length + ' lead' + (ids.length === 1 ? '' : 's') + '?')) return;
    var btn = document.getElementById('waBulkSendBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    fetch('/api/accounts/' + accountId + '/re/whatsapp/bulk-send-template', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadIds: ids })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) {
          showToast(r.d.error || 'Bulk send failed.');
          if (btn) { btn.disabled = false; btn.textContent = 'Send outreach template'; }
          return;
        }
        showToast('Sent to ' + r.d.sent + ' lead' + (r.d.sent === 1 ? '' : 's') + (r.d.failed ? ', ' + r.d.failed + ' failed' : '') + '.');
        ttState('waLeads').selected.clear();
        renderWaLeadsPanel();
        fetch('/api/accounts/' + accountId + '/re/whatsapp/conversations').then(function (res) { return res.json(); }).then(renderWaConvos);
      })
      .catch(function () {
        showToast('Bulk send failed.');
        if (btn) { btn.disabled = false; btn.textContent = 'Send outreach template'; }
      });
  }

  function renderWaSetup(status) {
    document.getElementById('waCallbackUrl').value = status.callbackUrl || '';
    document.getElementById('waVerifyToken').value = status.verifyToken || '(not set — add WHATSAPP_VERIFY_TOKEN to .env)';
    document.getElementById('waTemplateName').textContent = status.templateName ? (status.templateName + ' (' + status.templateLang + ')') : 'Not set — add OUTREACH_TEMPLATE_NAME to .env';

    var banner = document.getElementById('waSetupBanner');
    if (!status.whatsappConfigured) {
      banner.className = 'wa-banner warn';
      banner.style.display = '';
      banner.textContent = 'WhatsApp isn’t fully configured yet — set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN in .env, then restart the server.';
      document.getElementById('waSetupSub').textContent = 'Not configured';
    } else if (!status.agentConfigured) {
      banner.className = 'wa-banner warn';
      banner.style.display = '';
      banner.textContent = 'WhatsApp sending/receiving is wired up, but ANTHROPIC_API_KEY isn’t set — inbound messages will be logged but Ina won’t auto-reply.';
      document.getElementById('waSetupSub').textContent = 'Partially configured';
    } else if (!status.wiredToThisAccount) {
      banner.className = 'wa-banner warn';
      banner.style.display = '';
      banner.textContent = 'WhatsApp is configured, but inbound messages are currently routed to a different account. Set WHATSAPP_ACCOUNT_ID in .env to this account’s ID if that’s not intended.';
      document.getElementById('waSetupSub').textContent = 'Connected — different account';
    } else {
      banner.className = 'wa-banner ok';
      banner.style.display = '';
      banner.textContent = 'Connected. Inbound WhatsApp messages become leads here automatically, and Ina replies using this account’s real inventory.';
      document.getElementById('waSetupSub').textContent = 'Connected';
    }
  }

  function renderWaConvos(threads) {
    document.getElementById('waConvosSub').textContent = threads.length + (threads.length === 1 ? ' conversation' : ' conversations');
    document.getElementById('waConvosList').innerHTML = threads.map(function (t) {
      var preview = (t.lastDirection === 'out' ? 'You: ' : '') + (t.lastMessage || '');
      return '<div class="wa-convo-row" data-open-wa-lead="' + t.leadId + '">' +
        '<div class="avatar" style="background:' + avatarColor(t.name) + ';">' + initials(t.name) + '</div>' +
        '<div class="body"><div class="top"><strong>' + (t.name || t.phone) + '</strong>' +
        '<span class="status-pill ' + reStatusClass(t.status) + '" style="margin-left:6px;">' + t.status + '</span>' +
        '<span class="when">' + timeAgo(t.lastMessageAt) + '</span></div>' +
        '<div class="preview">' + preview + '</div></div></div>';
    }).join('') || '<div class="empty-note">No WhatsApp conversations yet — once a lead messages your business number, they’ll show up here.</div>';
    document.querySelectorAll('[data-open-wa-lead]').forEach(function (row) {
      row.addEventListener('click', function () {
        openWaChat(row.getAttribute('data-open-wa-lead'));
      });
    });
  }

  // -- WhatsApp outreach: inline chat window (replaces the conversations
  // list in place, rather than navigating away to the lead detail page) --
  var activeWaChatLeadId = null;

  function openWaChat(leadId) {
    var lead = (currentData && currentData.leads || []).find(function (l) { return l.id === leadId; });
    activeWaChatLeadId = leadId;
    document.getElementById('waConvosPanel').style.display = 'none';
    document.getElementById('waChatPanel').style.display = '';
    var avatar = document.getElementById('waChatAvatar');
    avatar.style.background = avatarColor(lead ? lead.name : leadId);
    avatar.textContent = initials(lead ? lead.name : '?');
    document.getElementById('waChatName').textContent = lead ? lead.name : 'Lead';
    document.getElementById('waChatPhone').textContent = lead ? lead.phone : '';
    document.getElementById('waChatInput').value = '';
    loadWaChatMessages();
  }

  function closeWaChat() {
    activeWaChatLeadId = null;
    document.getElementById('waChatPanel').style.display = 'none';
    document.getElementById('waConvosPanel').style.display = '';
    fetch('/api/accounts/' + accountId + '/re/whatsapp/conversations').then(function (res) { return res.json(); }).then(renderWaConvos);
  }

  function loadWaChatMessages() {
    var leadId = activeWaChatLeadId;
    var box = document.getElementById('waChatMessages');
    box.innerHTML = '<div class="empty-note" style="padding:16px 0;"><span class="spinner"></span></div>';
    fetch('/api/accounts/' + accountId + '/re/whatsapp/conversations/' + leadId)
      .then(function (res) { return res.json(); })
      .then(function (messages) {
        if (activeWaChatLeadId !== leadId) return;
        box.innerHTML = messages.map(function (m) {
          return '<div class="wa-bubble-row ' + m.direction + '"><div class="wa-bubble ' + m.direction + '">' +
            escapeHtmlWa(m.message) + '<div class="when">' + timeAgo(m.at) + '</div></div></div>';
        }).join('') || '<div class="empty-note" style="padding:16px 0;">No WhatsApp messages with this lead yet.</div>';
        box.scrollTop = box.scrollHeight;
      })
      .catch(function () { box.innerHTML = '<div class="empty-note" style="padding:16px 0;">Could not load messages.</div>'; });
  }

  document.getElementById('waChatBack').addEventListener('click', function (e) { e.preventDefault(); closeWaChat(); });

  document.getElementById('waChatSend').addEventListener('click', function () {
    if (!activeWaChatLeadId) return;
    var input = document.getElementById('waChatInput');
    var text = input.value.trim();
    if (!text) return;
    var btn = document.getElementById('waChatSend');
    btn.disabled = true;
    fetch('/api/accounts/' + accountId + '/re/whatsapp/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: activeWaChatLeadId, text: text })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) { showToast(r.d.error); return; }
        input.value = '';
        loadWaChatMessages();
      });
  });
  document.getElementById('waChatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('waChatSend').click();
  });

  document.getElementById('waChatSendTemplate').addEventListener('click', function () {
    if (!activeWaChatLeadId) return;
    var btn = document.getElementById('waChatSendTemplate');
    btn.disabled = true;
    fetch('/api/accounts/' + accountId + '/re/whatsapp/send-template', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: activeWaChatLeadId })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) { showToast(r.d.error); return; }
        showToast('Template sent.');
        loadWaChatMessages();
      });
  });

  document.querySelectorAll('[data-copy-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-copy-target'));
      if (!input || !input.value) return;
      navigator.clipboard.writeText(input.value).then(function () {
        var orig = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = orig; }, 1500);
      });
    });
  });

  // -- WhatsApp panel on lead detail page --
  function loadRldWaMessages(leadId) {
    var box = document.getElementById('rldWaMessages');
    box.innerHTML = '<div class="empty-note" style="padding:16px 0;"><span class="spinner"></span></div>';
    fetch('/api/accounts/' + accountId + '/re/whatsapp/conversations/' + leadId)
      .then(function (res) { return res.json(); })
      .then(function (messages) {
        if (!activeDetail || activeDetail.type !== 'lead' || activeDetail.id !== leadId) return;
        box.innerHTML = messages.map(function (m) {
          return '<div class="wa-bubble-row ' + m.direction + '"><div class="wa-bubble ' + m.direction + '">' +
            escapeHtmlWa(m.message) + '<div class="when">' + timeAgo(m.at) + '</div></div></div>';
        }).join('') || '<div class="empty-note" style="padding:16px 0;">No WhatsApp messages with this lead yet.</div>';
        box.scrollTop = box.scrollHeight;
      })
      .catch(function () { box.innerHTML = '<div class="empty-note" style="padding:16px 0;">Could not load messages.</div>'; });
  }

  function escapeHtmlWa(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.getElementById('rldSendTemplateBtn').addEventListener('click', function () {
    if (!activeDetail || activeDetail.type !== 'lead') return;
    var btn = document.getElementById('rldSendTemplateBtn');
    btn.disabled = true;
    fetch('/api/accounts/' + accountId + '/re/whatsapp/send-template', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: activeDetail.id })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) { showToast(r.d.error); return; }
        showToast('Template sent.');
        loadRldWaMessages(activeDetail.id);
      });
  });

  document.getElementById('rldWaSend').addEventListener('click', function () {
    if (!activeDetail || activeDetail.type !== 'lead') return;
    var input = document.getElementById('rldWaInput');
    var text = input.value.trim();
    if (!text) return;
    var btn = document.getElementById('rldWaSend');
    btn.disabled = true;
    fetch('/api/accounts/' + accountId + '/re/whatsapp/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: activeDetail.id, text: text })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) { showToast(r.d.error); return; }
        input.value = '';
        loadRldWaMessages(activeDetail.id);
      });
  });

  // ---- Real Estate CRM: add/edit modals ----
  var RE_LEAD_STATUSES = ['New', 'Contacted', 'Site Visit', 'Negotiation', 'Closed', 'Lost'];
  var RE_LEAD_SOURCES = ['WhatsApp', 'Email', 'Facebook Ads', 'Instagram Ads', 'Google Ads', 'Property Finder', 'Bayut', 'Dubizzle', '99acres', 'MagicBricks', 'Website Form', 'Referral', 'Walk-in', 'Cold Canvass', 'Excel Import', 'Manual Entry'];

  // Every source bucket into one of a handful of icons so the "where did
  // this lead come from" view stays scannable even with 16 exact values.
  var SOURCE_ICONS = {
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.3-1.93 1.36-.5.06-1.05.28-3.5-.73-2.96-1.22-4.86-4.2-5.01-4.4-.15-.19-1.2-1.6-1.2-3.05s.76-2.16 1.03-2.46c.26-.29.58-.36.77-.36.2 0 .39 0 .56.01.18.01.42-.07.65.5.24.58.82 2.01.9 2.16.07.15.12.32.02.51-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.52 1.9 1.05.94 1.93 1.23 2.21 1.37.28.14.44.12.6-.07.17-.19.71-.83.9-1.11.19-.28.38-.24.63-.14.26.09 1.66.78 1.94.93.28.14.47.21.53.33.07.12.07.68-.17 1.36z"></path></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m2 7 10 6 10-6"></path></svg>',
    ads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"></path><path d="M17 8a4 4 0 0 1 0 8"></path><path d="M21 5a8 8 0 0 1 0 14"></path></svg>',
    portal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"></path></svg>',
    referral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    walkin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2C20 17.5 12 22 12 22z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
    import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M12 18v-6"></path><path d="m9 15 3-3 3 3"></path></svg>'
  };
  var SOURCE_ICON_KEY = {
    'WhatsApp': 'whatsapp', 'Email': 'email',
    'Facebook Ads': 'ads', 'Instagram Ads': 'ads', 'Google Ads': 'ads',
    'Property Finder': 'portal', 'Bayut': 'portal', 'Dubizzle': 'portal', '99acres': 'portal', 'MagicBricks': 'portal', 'Website Form': 'portal',
    'Referral': 'referral',
    'Walk-in': 'walkin', 'Cold Canvass': 'walkin',
    'Excel Import': 'import', 'Manual Entry': 'import'
  };
  var SOURCE_ICON_CLASS = {
    whatsapp: 'src-whatsapp', email: 'src-email', ads: 'src-ads', portal: 'src-portal',
    referral: 'src-referral', walkin: 'src-walkin', import: 'src-import'
  };
  function sourceBadge(source) {
    var label = source || 'Unknown';
    var key = SOURCE_ICON_KEY[label] || 'portal';
    var cls = SOURCE_ICON_CLASS[key] || 'src-portal';
    return '<span class="source-badge ' + cls + '">' + (SOURCE_ICONS[key] || '') + '<span>' + label + '</span></span>';
  }
  var RE_INVENTORY_STATUSES = ['Available', 'Reserved', 'Negotiation', 'Sold'];
  var RE_ACCOUNTING_STATUSES = ['Pending', 'Received'];
  var RE_BROKER_STATUSES = ['Active', 'Inactive'];
  var RE_SITE_VISIT_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No-show'];

  function fillSelect(selectEl, options, selected) {
    selectEl.innerHTML = options.map(function (o) {
      return '<option value="' + o + '"' + (o === selected ? ' selected' : '') + '>' + o + '</option>';
    }).join('');
  }

  // -- lead modal --
  var reLeadModal = document.getElementById('reLeadModal');
  var editingReLeadId = null;

  function openReLeadModal(leadId) {
    if (!currentData) return;
    editingReLeadId = leadId || null;
    var l = leadId ? currentData.leads.filter(function (x) { return x.id === leadId; })[0] : null;
    document.getElementById('reLeadModalTitle').textContent = l ? 'Edit lead' : 'Add lead';
    document.getElementById('reLeadName').value = l ? l.name : '';
    document.getElementById('reLeadPhone').value = l ? (l.phone || '') : '';
    document.getElementById('reLeadEmail').value = l ? (l.email || '') : '';
    document.getElementById('reLeadProperty').value = l ? (l.propertyInterest || '') : '';
    fillSelect(document.getElementById('reLeadSource'), RE_LEAD_SOURCES, l ? l.source : 'Website Form');
    document.getElementById('reLeadBudget').value = l ? (l.budget || 0) : '';
    fillSelect(document.getElementById('reLeadStatus'), RE_LEAD_STATUSES, l ? l.status : 'New');
    var brokerOptions = '<option value="">Unassigned</option>' + (currentData.brokers || []).map(function (b) {
      return '<option value="' + b.id + '"' + (l && l.brokerId === b.id ? ' selected' : '') + '>' + b.name + '</option>';
    }).join('');
    document.getElementById('reLeadBroker').innerHTML = brokerOptions;
    document.getElementById('reLeadFollowup').value = l ? (l.nextFollowup || '') : '';
    document.getElementById('reLeadNationality').value = l ? (l.nationality || '') : '';
    document.getElementById('reLeadRemarks').value = l ? (l.remarks || '') : '';
    reLeadModal.classList.add('show');
  }

  document.getElementById('reAddLeadBtn').addEventListener('click', function () { openReLeadModal(null); });

  document.getElementById('reUploadLeadsBtn').addEventListener('click', function () {
    document.getElementById('reUploadLeadsInput').click();
  });
  document.getElementById('reUploadLeadsInput').addEventListener('change', function () {
    var input = this;
    var file = input.files[0];
    if (!file) return;
    var btn = document.getElementById('reUploadLeadsBtn');
    var original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Uploading...';
    var fd = new FormData();
    fd.append('file', file);
    fetch('/api/accounts/' + accountId + '/re/leads/upload', { method: 'POST', body: fd })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = original;
        input.value = '';
        if (!r.ok) { showToast(r.d.error || 'Upload failed.'); return; }
        var msg = r.d.added + (r.d.added === 1 ? ' lead' : ' leads') + ' imported from ' + file.name + '.' +
          (r.d.skipped ? ' ' + r.d.skipped + ' row(s) skipped.' : '');
        showToast(msg);
        loadAccount();
      })
      .catch(function () {
        btn.disabled = false;
        btn.innerHTML = original;
        input.value = '';
        showToast('Upload failed — check your connection and try again.');
      });
  });
  document.getElementById('reLeadClose').addEventListener('click', function () { reLeadModal.classList.remove('show'); });
  reLeadModal.addEventListener('click', function (e) { if (e.target === reLeadModal) reLeadModal.classList.remove('show'); });
  document.getElementById('reLeadSave').addEventListener('click', function () {
    var name = document.getElementById('reLeadName').value.trim();
    if (!name) { showToast('Name is required.'); return; }
    var payload = {
      name: name,
      phone: document.getElementById('reLeadPhone').value.trim(),
      email: document.getElementById('reLeadEmail').value.trim(),
      propertyInterest: document.getElementById('reLeadProperty').value.trim(),
      source: document.getElementById('reLeadSource').value || 'Manual Entry',
      budget: Number(document.getElementById('reLeadBudget').value) || 0,
      status: document.getElementById('reLeadStatus').value,
      brokerId: document.getElementById('reLeadBroker').value || null,
      nextFollowup: document.getElementById('reLeadFollowup').value || null,
      nationality: document.getElementById('reLeadNationality').value.trim(),
      remarks: document.getElementById('reLeadRemarks').value.trim()
    };
    var btn = document.getElementById('reLeadSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
    var url = '/api/accounts/' + accountId + '/re/leads' + (editingReLeadId ? '/' + editingReLeadId : '');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Save lead';
        if (!r.ok) { showToast(r.d.error); return; }
        reLeadModal.classList.remove('show');
        showToast(editingReLeadId ? 'Lead updated.' : 'Lead added.');
        loadAccount();
      });
  });

  // -- broker modal --
  var reBrokerModal = document.getElementById('reBrokerModal');
  var editingReBrokerId = null;

  function openReBrokerModal(brokerId) {
    if (!currentData) return;
    editingReBrokerId = brokerId || null;
    var b = brokerId ? currentData.brokers.filter(function (x) { return x.id === brokerId; })[0] : null;
    document.getElementById('reBrokerModalTitle').textContent = b ? 'Edit broker' : 'Add broker';
    document.getElementById('reBrokerName').value = b ? b.name : '';
    document.getElementById('reBrokerPhone').value = b ? (b.phone || '') : '';
    document.getElementById('reBrokerEmail').value = b ? (b.email || '') : '';
    document.getElementById('reBrokerZone').value = b ? (b.zone || '') : '';
    fillSelect(document.getElementById('reBrokerStatus'), RE_BROKER_STATUSES, b ? b.status : 'Active');
    document.getElementById('reBrokerCommission').value = b ? (b.commissionPct || '') : '';
    document.getElementById('reBrokerActiveLeads').value = b ? (b.activeLeads || 0) : 0;
    document.getElementById('reBrokerClosedDeals').value = b ? (b.closedDeals || 0) : 0;
    document.getElementById('reBrokerTarget').value = b ? (b.salesTarget || 0) : 0;
    document.getElementById('reBrokerRevenue').value = b ? (b.revenueAchieved || 0) : 0;
    document.getElementById('reBrokerLicense').value = b ? (b.licenseNo || '') : '';
    document.getElementById('reBrokerJoined').value = b ? (b.joinedAt || '') : '';
    reBrokerModal.classList.add('show');
  }

  document.getElementById('reAddBrokerBtn').addEventListener('click', function () { openReBrokerModal(null); });
  document.getElementById('reBrokerClose').addEventListener('click', function () { reBrokerModal.classList.remove('show'); });
  reBrokerModal.addEventListener('click', function (e) { if (e.target === reBrokerModal) reBrokerModal.classList.remove('show'); });
  document.getElementById('reBrokerSave').addEventListener('click', function () {
    var name = document.getElementById('reBrokerName').value.trim();
    if (!name) { showToast('Name is required.'); return; }
    var payload = {
      name: name,
      phone: document.getElementById('reBrokerPhone').value.trim(),
      email: document.getElementById('reBrokerEmail').value.trim(),
      zone: document.getElementById('reBrokerZone').value.trim(),
      status: document.getElementById('reBrokerStatus').value,
      commissionPct: document.getElementById('reBrokerCommission').value.trim(),
      activeLeads: Number(document.getElementById('reBrokerActiveLeads').value) || 0,
      closedDeals: Number(document.getElementById('reBrokerClosedDeals').value) || 0,
      salesTarget: Number(document.getElementById('reBrokerTarget').value) || 0,
      revenueAchieved: Number(document.getElementById('reBrokerRevenue').value) || 0,
      licenseNo: document.getElementById('reBrokerLicense').value.trim(),
      joinedAt: document.getElementById('reBrokerJoined').value || null
    };
    var btn = document.getElementById('reBrokerSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
    var url = '/api/accounts/' + accountId + '/re/brokers' + (editingReBrokerId ? '/' + editingReBrokerId : '');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Save broker';
        if (!r.ok) { showToast(r.d.error); return; }
        reBrokerModal.classList.remove('show');
        showToast(editingReBrokerId ? 'Broker updated.' : 'Broker added.');
        loadAccount();
      });
  });

  // -- inventory modal --
  var reInventoryModal = document.getElementById('reInventoryModal');
  var editingReInventoryId = null;

  function openReInventoryModal(itemId) {
    if (!currentData) return;
    editingReInventoryId = itemId || null;
    var i = itemId ? currentData.inventory.filter(function (x) { return x.id === itemId; })[0] : null;
    document.getElementById('reInventoryModalTitle').textContent = i ? 'Edit unit' : 'Add unit';
    document.getElementById('reInvProject').value = i ? i.projectName : '';
    document.getElementById('reInvUnit').value = i ? (i.unitNo || '') : '';
    document.getElementById('reInvType').value = i ? (i.type || '') : '';
    document.getElementById('reInvArea').value = i ? (i.areaSqft || '') : '';
    document.getElementById('reInvPrice').value = i ? (i.price || 0) : '';
    fillSelect(document.getElementById('reInvStatus'), RE_INVENTORY_STATUSES, i ? i.status : 'Available');
    document.getElementById('reInvLocation').value = i ? (i.location || '') : '';
    document.getElementById('reInvBedrooms').value = i && i.bedrooms != null ? i.bedrooms : '';
    document.getElementById('reInvBathrooms').value = i && i.bathrooms != null ? i.bathrooms : '';
    document.getElementById('reInvPossession').value = i ? (i.possessionDate || '') : '';
    document.getElementById('reInvAmenities').value = i ? (i.amenities || '') : '';
    document.getElementById('reInvDescription').value = i ? (i.description || '') : '';
    document.getElementById('reInvLat').value = i && i.latitude != null ? i.latitude : '';
    document.getElementById('reInvLng').value = i && i.longitude != null ? i.longitude : '';
    reInventoryModal.classList.add('show');
  }

  document.getElementById('reAddInventoryBtn').addEventListener('click', function () { openReInventoryModal(null); });
  document.getElementById('reInventoryClose').addEventListener('click', function () { reInventoryModal.classList.remove('show'); });
  reInventoryModal.addEventListener('click', function (e) { if (e.target === reInventoryModal) reInventoryModal.classList.remove('show'); });
  document.getElementById('reInventorySave').addEventListener('click', function () {
    var projectName = document.getElementById('reInvProject').value.trim();
    if (!projectName) { showToast('Project name is required.'); return; }
    var payload = {
      projectName: projectName,
      unitNo: document.getElementById('reInvUnit').value.trim(),
      type: document.getElementById('reInvType').value.trim(),
      areaSqft: Number(document.getElementById('reInvArea').value) || 0,
      price: Number(document.getElementById('reInvPrice').value) || 0,
      status: document.getElementById('reInvStatus').value,
      location: document.getElementById('reInvLocation').value.trim(),
      bedrooms: document.getElementById('reInvBedrooms').value === '' ? null : Number(document.getElementById('reInvBedrooms').value),
      bathrooms: document.getElementById('reInvBathrooms').value === '' ? null : Number(document.getElementById('reInvBathrooms').value),
      possessionDate: document.getElementById('reInvPossession').value || null,
      amenities: document.getElementById('reInvAmenities').value.trim(),
      description: document.getElementById('reInvDescription').value.trim(),
      latitude: document.getElementById('reInvLat').value.trim() === '' ? null : Number(document.getElementById('reInvLat').value),
      longitude: document.getElementById('reInvLng').value.trim() === '' ? null : Number(document.getElementById('reInvLng').value)
    };
    var btn = document.getElementById('reInventorySave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
    var url = '/api/accounts/' + accountId + '/re/inventory' + (editingReInventoryId ? '/' + editingReInventoryId : '');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Save unit';
        if (!r.ok) { showToast(r.d.error); return; }
        reInventoryModal.classList.remove('show');
        showToast(editingReInventoryId ? 'Unit updated.' : 'Unit added.');
        loadAccount();
      });
  });

  // -- accounting modal --
  var reAccountingModal = document.getElementById('reAccountingModal');
  var editingReAccountingId = null;

  function openReAccountingModal(txnId) {
    if (!currentData) return;
    editingReAccountingId = txnId || null;
    var t = txnId ? currentData.accounting.filter(function (x) { return x.id === txnId; })[0] : null;
    document.getElementById('reAccountingModalTitle').textContent = t ? 'Edit transaction' : 'Add transaction';
    document.getElementById('reTxnClient').value = t ? (t.clientName || '') : '';
    document.getElementById('reTxnDate').value = t ? (t.date || '') : '';
    document.getElementById('reTxnProperty').value = t ? (t.property || '') : '';
    document.getElementById('reTxnAmount').value = t ? (t.amount || 0) : '';
    document.getElementById('reTxnType').value = t ? (t.type || '') : '';
    document.getElementById('reTxnBroker').value = t ? (t.brokerName || '') : '';
    document.getElementById('reTxnPaymentMode').value = t ? (t.paymentMode || '') : '';
    fillSelect(document.getElementById('reTxnStatus'), RE_ACCOUNTING_STATUSES, t ? t.status : 'Pending');
    reAccountingModal.classList.add('show');
  }

  document.getElementById('reAddAccountingBtn').addEventListener('click', function () { openReAccountingModal(null); });
  document.getElementById('reAccountingClose').addEventListener('click', function () { reAccountingModal.classList.remove('show'); });
  reAccountingModal.addEventListener('click', function (e) { if (e.target === reAccountingModal) reAccountingModal.classList.remove('show'); });
  document.getElementById('reAccountingSave').addEventListener('click', function () {
    var clientName = document.getElementById('reTxnClient').value.trim();
    if (!clientName) { showToast('Client name is required.'); return; }
    var payload = {
      clientName: clientName,
      txnDate: document.getElementById('reTxnDate').value || null,
      property: document.getElementById('reTxnProperty').value.trim(),
      amount: Number(document.getElementById('reTxnAmount').value) || 0,
      type: document.getElementById('reTxnType').value.trim(),
      brokerName: document.getElementById('reTxnBroker').value.trim(),
      paymentMode: document.getElementById('reTxnPaymentMode').value.trim(),
      status: document.getElementById('reTxnStatus').value
    };
    var btn = document.getElementById('reAccountingSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
    var url = '/api/accounts/' + accountId + '/re/accounting' + (editingReAccountingId ? '/' + editingReAccountingId : '');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Save transaction';
        if (!r.ok) { showToast(r.d.error); return; }
        reAccountingModal.classList.remove('show');
        showToast(editingReAccountingId ? 'Transaction updated.' : 'Transaction added.');
        loadAccount();
      });
  });

  // -- site visit modal --
  var reVisitModal = document.getElementById('reVisitModal');
  var editingReVisitId = null;

  function openReVisitModal(visitId, presetLeadId) {
    if (!currentData) return;
    editingReVisitId = visitId || null;
    var v = visitId ? (currentData.siteVisits || []).filter(function (x) { return x.id === visitId; })[0] : null;
    document.getElementById('reVisitModalTitle').textContent = v ? 'Edit visit' : 'Schedule visit';

    var leadId = v ? v.leadId : (presetLeadId || '');
    document.getElementById('reVisitLead').innerHTML = '<option value="">Choose a lead…</option>' +
      (currentData.leads || []).map(function (l) {
        return '<option value="' + l.id + '"' + (l.id === leadId ? ' selected' : '') + '>' + l.name + '</option>';
      }).join('');

    document.getElementById('reVisitBroker').innerHTML = '<option value="">Unassigned</option>' +
      (currentData.brokers || []).map(function (b) {
        return '<option value="' + b.id + '"' + (v && v.brokerId === b.id ? ' selected' : '') + '>' + b.name + '</option>';
      }).join('');

    document.getElementById('reVisitInventory').innerHTML = '<option value="">No property</option>' +
      (currentData.inventory || []).map(function (i) {
        var label = i.projectName + (i.unitNo ? ' ' + i.unitNo : '');
        return '<option value="' + i.id + '"' + (v && v.inventoryId === i.id ? ' selected' : '') + '>' + label + '</option>';
      }).join('');

    document.getElementById('reVisitDate').value = v ? toDatetimeLocalValue(v.scheduledAt) : '';
    fillSelect(document.getElementById('reVisitStatus'), RE_SITE_VISIT_STATUSES, v ? v.status : 'Scheduled');
    document.getElementById('reVisitNotes').value = v ? (v.notes || '') : '';

    reVisitModal.classList.add('show');
  }

  document.getElementById('reAddVisitBtn').addEventListener('click', function () { openReVisitModal(null); });
  document.getElementById('reVisitClose').addEventListener('click', function () { reVisitModal.classList.remove('show'); });
  reVisitModal.addEventListener('click', function (e) { if (e.target === reVisitModal) reVisitModal.classList.remove('show'); });
  document.getElementById('reVisitSave').addEventListener('click', function () {
    var leadId = document.getElementById('reVisitLead').value;
    if (!leadId) { showToast('Pick a lead for this visit.'); return; }
    var dateVal = document.getElementById('reVisitDate').value;
    var payload = {
      leadId: leadId,
      brokerId: document.getElementById('reVisitBroker').value || null,
      inventoryId: document.getElementById('reVisitInventory').value || null,
      scheduledAt: dateVal ? new Date(dateVal).getTime() : null,
      status: document.getElementById('reVisitStatus').value,
      notes: document.getElementById('reVisitNotes').value.trim()
    };
    var btn = document.getElementById('reVisitSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
    var url = '/api/accounts/' + accountId + '/re/site-visits' + (editingReVisitId ? '/' + editingReVisitId : '');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.innerHTML = 'Save visit';
        if (!r.ok) { showToast(r.d.error); return; }
        reVisitModal.classList.remove('show');
        showToast(editingReVisitId ? 'Visit updated.' : 'Visit scheduled.');
        loadAccount();
      });
  });

  // ---- Real Estate CRM: dashboard charts (hand-drawn inline SVG, no dependency) ----
  var RE_STAGE_COLORS = {
    'New': '#22d3ee', 'Contacted': '#0f6fb0', 'Site Visit': '#c98a1c',
    'Negotiation': '#5b3fc0', 'Closed': '#0e8f5f', 'Lost': '#d64545'
  };
  var RE_STAGE_ORDER = ['New', 'Contacted', 'Site Visit', 'Negotiation', 'Closed', 'Lost'];
  var RE_SOURCE_COLORS = ['#22d3ee', '#7c5cff', '#0e8f5f', '#c98a1c', '#d64545', '#0f6fb0'];

  function renderReCharts(data) {
    var leads = data.leads || [];

    var counts = RE_STAGE_ORDER.map(function (s) { return leads.filter(function (l) { return l.status === s; }).length; });
    var maxCount = Math.max.apply(null, counts.concat([1]));
    var bars = RE_STAGE_ORDER.map(function (s, i) {
      var h = Math.round((counts[i] / maxCount) * 100);
      return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:130px;flex:1;">' +
        '<div style="font-size:10px;color:var(--faint);margin-bottom:4px;">' + counts[i] + '</div>' +
        '<div style="width:28px;height:' + Math.max(h, 3) + 'px;background:' + RE_STAGE_COLORS[s] + ';border-radius:4px 4px 0 0;"></div></div>';
    }).join('');
    document.getElementById('reChartPipeline').innerHTML =
      '<div style="display:flex;align-items:flex-end;gap:6px;">' + bars + '</div>' +
      '<div class="chart-legend">' + RE_STAGE_ORDER.map(function (s) {
        return '<span><i style="background:' + RE_STAGE_COLORS[s] + ';"></i>' + s + '</span>';
      }).join('') + '</div>';

    var bySource = {};
    leads.forEach(function (l) {
      var src = l.source || 'Other';
      bySource[src] = (bySource[src] || 0) + 1;
    });
    var sourceKeys = Object.keys(bySource);
    var total = leads.length || 1;
    var r = 50, c = 2 * Math.PI * r, offset = 0;
    var circles = sourceKeys.map(function (k, i) {
      var frac = bySource[k] / total;
      var len = frac * c;
      var html = '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + RE_SOURCE_COLORS[i % RE_SOURCE_COLORS.length] + '" stroke-width="16" stroke-dasharray="' + len.toFixed(1) + ' ' + c.toFixed(1) + '" stroke-dashoffset="' + (-offset).toFixed(1) + '" transform="rotate(-90 60 60)"></circle>';
      offset += len;
      return html;
    }).join('');
    document.getElementById('reChartSource').innerHTML = sourceKeys.length
      ? '<svg viewBox="0 0 120 120" width="140" height="140"><circle cx="60" cy="60" r="' + r + '" fill="none" stroke="var(--surface2)" stroke-width="16"></circle>' + circles + '</svg>' +
        '<div class="chart-legend">' + sourceKeys.map(function (k, i) {
          var pct = Math.round((bySource[k] / total) * 100);
          return '<span><i style="background:' + RE_SOURCE_COLORS[i % RE_SOURCE_COLORS.length] + ';"></i>' + k + ' ' + pct + '%</span>';
        }).join('') + '</div>'
      : '<div class="empty-note">No leads yet.</div>';

    var days = [];
    for (var i = 13; i >= 0; i--) {
      var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      days.push(d.getTime());
    }
    var dayCounts = days.map(function (dayStart) {
      var dayEnd = dayStart + 86400000;
      return leads.filter(function (l) { return l.createdAt >= dayStart && l.createdAt < dayEnd; }).length;
    });
    var cum = []; var running = 0;
    dayCounts.forEach(function (n) { running += n; cum.push(running); });
    var maxCum = Math.max.apply(null, cum.concat([1]));
    var w = 640, h = 130, stepX = w / (cum.length - 1 || 1);
    var points = cum.map(function (v, idx) {
      var x = Math.round(idx * stepX);
      var y = Math.round(h - (v / maxCum) * (h - 10) - 5);
      return x + ',' + y;
    }).join(' ');
    var areaPoints = points + ' ' + w + ',' + h + ' 0,' + h;
    document.getElementById('reChartGrowth').innerHTML =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="150" preserveAspectRatio="none">' +
      '<polyline points="' + areaPoints + '" fill="rgba(34,211,238,.12)" stroke="none"></polyline>' +
      '<polyline points="' + points + '" fill="none" stroke="#22d3ee" stroke-width="2.5"></polyline>' +
      '<line x1="0" y1="' + h + '" x2="' + w + '" y2="' + h + '" stroke="var(--border)" stroke-width="1"></line></svg>';
  }

  // ---- Real Estate CRM: lead / broker / inventory detail views ----
  var activeDetail = null;

  function showSection(sectionId) {
    document.querySelectorAll('.view-section').forEach(function (s) { s.classList.remove('active'); });
    var el = document.getElementById(sectionId);
    if (el) el.classList.add('active');
    updateInaFloatVisibility(sectionId === 'viewDashboard');
  }

  // The Ina agent widget floats bottom-right only while the Real Estate
  // dashboard is the visible section — it tucks away everywhere else.
  function updateInaFloatVisibility(show) {
    var wrap = document.getElementById('reInaFloat');
    if (!wrap) return;
    wrap.style.display = show ? 'flex' : 'none';
    if (!show) document.getElementById('reInaFloatWindow').style.display = 'none';
  }

  function renderReTimeline(elId, url, emptyText) {
    document.getElementById(elId).innerHTML = '<div class="empty-note"><span class="spinner"></span> Loading...</div>';
    fetch(url).then(function (res) { return res.json(); }).then(function (d) {
      var items = d.activity || [];
      document.getElementById(elId).innerHTML = items.map(function (item) {
        return '<div class="tl-item"><div class="tl-dot"></div><div class="tl-body">' + item.text +
          '<div class="when">' + timeAgo(item.at) + (item.actor ? ' · ' + item.actor : '') + '</div></div></div>';
      }).join('') || '<div class="empty-note">' + emptyText + '</div>';
    }).catch(function () {
      document.getElementById(elId).innerHTML = '<div class="empty-note">Couldn\'t load activity.</div>';
    });
  }

  function bindOpenLeadLinks(containerId) {
    document.querySelectorAll('#' + containerId + ' [data-open-lead]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openReLeadDetail(a.getAttribute('data-open-lead')); });
    });
  }

  // Saves a lead with one or more fields overridden (e.g. just brokerId),
  // reusing the full update-lead endpoint so nothing else on the lead gets
  // clobbered. Used by the reassign/unassign broker controls below.
  function saveReLeadFields(leadId, overrides) {
    var l = currentData.leads.filter(function (x) { return x.id === leadId; })[0];
    if (!l) return null;
    var payload = {
      name: l.name, phone: l.phone, email: l.email, source: l.source,
      propertyInterest: l.propertyInterest, budget: l.budget, status: l.status,
      brokerId: l.brokerId, nextFollowup: l.nextFollowup, nationality: l.nationality, remarks: l.remarks
    };
    for (var k in overrides) { payload[k] = overrides[k]; }
    return fetch('/api/accounts/' + accountId + '/re/leads/' + leadId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); });
  }

  function openReLeadDetail(leadId) {
    if (!currentData) return;
    var l = currentData.leads.filter(function (x) { return x.id === leadId; })[0];
    if (!l) return;
    activeDetail = { type: 'lead', id: leadId };

    document.getElementById('rldPageTitle').textContent = l.name;
    document.getElementById('rldAvatar').textContent = initials(l.name);
    document.getElementById('rldAvatar').style.background = avatarColor(l.name);
    document.getElementById('rldName').textContent = l.name;
    document.getElementById('rldStage').innerHTML = '<span class="status-pill ' + reStatusClass(l.status) + '">' + l.status + '</span>';
    document.getElementById('rldCallLink').href = l.phone ? ('tel:' + l.phone) : '#';
    document.getElementById('rldEmailLink').href = l.email ? ('mailto:' + l.email) : '#';
    document.getElementById('rldPhoneLine').textContent = l.phone || 'No phone on file';
    document.getElementById('rldEmailLine').textContent = l.email || 'No email on file';
    document.getElementById('rldBudget').textContent = reMoney(l.budget);
    var ageDays = l.createdAt ? Math.max(0, Math.floor((Date.now() - l.createdAt) / 86400000)) : 0;
    document.getElementById('rldAge').textContent = ageDays + (ageDays === 1 ? ' day' : ' days');
    var ownerOptions = '<option value="">Unassigned</option>' + (currentData.brokers || []).map(function (b) {
      return '<option value="' + b.id + '"' + (l.brokerId === b.id ? ' selected' : '') + '>' + b.name + '</option>';
    }).join('');
    document.getElementById('rldOwnerSelect').innerHTML = ownerOptions;
    document.getElementById('rldSource').innerHTML = l.source ? sourceBadge(l.source) : '—';
    document.getElementById('rldInterest').textContent = l.propertyInterest || '—';
    document.getElementById('rldFollowup').textContent = l.nextFollowup || '—';
    document.getElementById('rldNationality').textContent = l.nationality || '—';

    var leadVisits = (currentData.siteVisits || []).filter(function (v) { return v.leadId === leadId; })
      .sort(function (a, b) { return (b.scheduledAt || 0) - (a.scheduledAt || 0); });
    document.getElementById('rldVisitsList').innerHTML = leadVisits.map(function (v) {
      return '<div class="mini-lead-row"><div><span style="font-weight:600;color:var(--text);">' + (v.propertyLabel || 'Site visit') + '</span>' +
        '<div class="meta">' + fmtDateTime(v.scheduledAt) + '</div></div>' +
        '<span style="display:flex;align-items:center;gap:10px;"><span class="status-pill ' + reStatusClass(v.status) + '">' + v.status + '</span>' +
        '<button class="link-btn" data-edit-visit="' + v.id + '">Edit</button></span></div>';
    }).join('') || '<div class="empty-note">No site visits scheduled for this lead yet.</div>';
    document.querySelectorAll('#rldVisitsList [data-edit-visit]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReVisitModal(btn.getAttribute('data-edit-visit')); });
    });

    showSection('viewReLeadDetail');
    renderReTimeline('rldTimeline', '/api/accounts/' + accountId + '/re/leads/' + leadId + '/activity', 'No activity on this lead yet.');
    loadRldWaMessages(leadId);
  }

  document.getElementById('rldEditBtn').addEventListener('click', function () {
    if (activeDetail && activeDetail.type === 'lead') openReLeadModal(activeDetail.id);
  });
  document.getElementById('rldScheduleVisitBtn').addEventListener('click', function () {
    if (activeDetail && activeDetail.type === 'lead') openReVisitModal(null, activeDetail.id);
  });
  document.getElementById('rldBack').addEventListener('click', function (e) {
    e.preventDefault(); activeDetail = null; switchView('releads');
  });
  document.getElementById('rldOwnerSelect').addEventListener('change', function () {
    if (!activeDetail || activeDetail.type !== 'lead') return;
    var select = this;
    var newBrokerId = select.value || null;
    saveReLeadFields(activeDetail.id, { brokerId: newBrokerId }).then(function (r) {
      if (!r.ok) { showToast(r.d.error); return; }
      showToast('Broker updated.');
      loadAccount();
    });
  });
  document.getElementById('rldNoteSubmit').addEventListener('click', function () {
    var input = document.getElementById('rldNoteInput');
    var text = input.value.trim();
    if (!text || !activeDetail || activeDetail.type !== 'lead') { showToast('Write a note first.'); return; }
    var btn = document.getElementById('rldNoteSubmit');
    btn.disabled = true;
    fetch('/api/accounts/' + accountId + '/re/leads/' + activeDetail.id + '/note', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: text })
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) { showToast(r.d.error); return; }
        input.value = '';
        showToast('Note added.');
        renderReTimeline('rldTimeline', '/api/accounts/' + accountId + '/re/leads/' + activeDetail.id + '/activity', 'No activity on this lead yet.');
      });
  });

  var rbdLeadFilter = null; // null | 'active' | 'closed' — which bucket the stat-box buttons are filtering "Assigned leads" to

  function openReBrokerDetail(brokerId) {
    if (!currentData) return;
    var b = currentData.brokers.filter(function (x) { return x.id === brokerId; })[0];
    if (!b) return;
    var isNewBroker = !activeDetail || activeDetail.type !== 'broker' || activeDetail.id !== brokerId;
    if (isNewBroker) rbdLeadFilter = null;
    activeDetail = { type: 'broker', id: brokerId };

    document.getElementById('rbdPageTitle').textContent = b.name;
    document.getElementById('rbdAvatar').textContent = initials(b.name);
    document.getElementById('rbdAvatar').style.background = avatarColor(b.name);
    document.getElementById('rbdName').textContent = b.name;
    document.getElementById('rbdStatus').innerHTML = '<span class="status-pill ' + reStatusClass(b.status) + '">' + b.status + '</span>';
    document.getElementById('rbdPhoneLine').textContent = b.phone || 'No phone on file';
    document.getElementById('rbdEmailLine').textContent = b.email || 'No email on file';
    document.getElementById('rbdActiveLeads').textContent = b.activeLeads || 0;
    document.getElementById('rbdClosedDeals').textContent = b.closedDeals || 0;
    document.getElementById('rbdZone').textContent = b.zone || '—';
    document.getElementById('rbdCommission').textContent = b.commissionPct || '—';
    document.getElementById('rbdTarget').textContent = reMoney(b.salesTarget);
    document.getElementById('rbdAchieved').textContent = reMoney(b.revenueAchieved);
    document.getElementById('rbdLicense').textContent = b.licenseNo || '—';
    document.getElementById('rbdJoined').textContent = b.joinedAt || '—';
    var pct = Math.round((b.achievedPct || 0) * 100);
    var fillClass = pct === 0 ? 'zero' : pct < 50 ? 'low' : '';
    document.getElementById('rbdProgressFill').className = 're-progress-fill' + (fillClass ? ' ' + fillClass : '');
    document.getElementById('rbdProgressFill').style.width = Math.min(pct, 100) + '%';
    document.getElementById('rbdProgressPct').textContent = pct + '% of target';

    var allAssigned = currentData.leads.filter(function (l) { return l.brokerId === brokerId; });
    var assigned = allAssigned;
    if (rbdLeadFilter === 'active') assigned = allAssigned.filter(function (l) { return l.status !== 'Closed' && l.status !== 'Lost'; });
    else if (rbdLeadFilter === 'closed') assigned = allAssigned.filter(function (l) { return l.status === 'Closed'; });

    document.getElementById('rbdActiveLeadsBtn').classList.toggle('active', rbdLeadFilter === 'active');
    document.getElementById('rbdClosedDealsBtn').classList.toggle('active', rbdLeadFilter === 'closed');
    document.getElementById('rbdLeadsFilterReset').style.display = rbdLeadFilter ? '' : 'none';
    document.getElementById('rbdLeadsSub').textContent = rbdLeadFilter
      ? assigned.length + ' of ' + allAssigned.length + (allAssigned.length === 1 ? ' lead' : ' leads') + ' · ' + (rbdLeadFilter === 'active' ? 'active' : 'closed')
      : allAssigned.length + (allAssigned.length === 1 ? ' lead' : ' leads');
    document.getElementById('rbdLeadsList').innerHTML = assigned.map(function (l) {
      return '<div class="mini-lead-row"><div><a href="#" data-open-lead="' + l.id + '" style="font-weight:600;color:var(--text);">' + l.name + '</a>' +
        '<div class="meta">' + (l.propertyInterest || 'No property noted') + '</div></div>' +
        '<span style="display:flex;align-items:center;gap:10px;"><span class="status-pill ' + reStatusClass(l.status) + '">' + l.status + '</span>' +
        '<button class="link-btn danger" data-unassign-lead="' + l.id + '">Remove</button></span></div>';
    }).join('') || '<div class="empty-note">' + (rbdLeadFilter ? 'No ' + rbdLeadFilter + ' leads for this broker.' : 'No leads assigned to this broker yet.') + '</div>';
    bindOpenLeadLinks('rbdLeadsList');
    document.querySelectorAll('#rbdLeadsList [data-unassign-lead]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        saveReLeadFields(btn.getAttribute('data-unassign-lead'), { brokerId: null }).then(function (r) {
          if (!r.ok) { showToast(r.d.error); return; }
          showToast('Lead unassigned.');
          loadAccount();
        });
      });
    });

    var assignable = currentData.leads.filter(function (l) { return l.brokerId !== brokerId; });
    document.getElementById('rbdAssignSelect').innerHTML = '<option value="">Choose a lead to assign…</option>' +
      assignable.map(function (l) {
        return '<option value="' + l.id + '">' + l.name + (l.broker ? ' (currently ' + l.broker + ')' : ' (unassigned)') + '</option>';
      }).join('');

    showSection('viewReBrokerDetail');
    renderReTimeline('rbdTimeline', '/api/accounts/' + accountId + '/re/brokers/' + brokerId + '/activity', 'No activity for this broker yet.');
  }

  document.getElementById('rbdEditBtn').addEventListener('click', function () {
    if (activeDetail && activeDetail.type === 'broker') openReBrokerModal(activeDetail.id);
  });
  document.getElementById('rbdBack').addEventListener('click', function (e) {
    e.preventDefault(); activeDetail = null; switchView('brokers');
  });
  document.getElementById('rbdAssignBtn').addEventListener('click', function () {
    if (!activeDetail || activeDetail.type !== 'broker') return;
    var leadId = document.getElementById('rbdAssignSelect').value;
    if (!leadId) { showToast('Pick a lead to assign first.'); return; }
    saveReLeadFields(leadId, { brokerId: activeDetail.id }).then(function (r) {
      if (!r.ok) { showToast(r.d.error); return; }
      showToast('Lead assigned.');
      loadAccount();
    });
  });
  document.getElementById('rbdActiveLeadsBtn').addEventListener('click', function () {
    if (!activeDetail || activeDetail.type !== 'broker') return;
    rbdLeadFilter = rbdLeadFilter === 'active' ? null : 'active';
    openReBrokerDetail(activeDetail.id);
  });
  document.getElementById('rbdClosedDealsBtn').addEventListener('click', function () {
    if (!activeDetail || activeDetail.type !== 'broker') return;
    rbdLeadFilter = rbdLeadFilter === 'closed' ? null : 'closed';
    openReBrokerDetail(activeDetail.id);
  });
  document.getElementById('rbdLeadsFilterReset').addEventListener('click', function () {
    rbdLeadFilter = null;
    if (activeDetail && activeDetail.type === 'broker') openReBrokerDetail(activeDetail.id);
  });

  function openReInventoryDetail(itemId) {
    if (!currentData) return;
    var i = currentData.inventory.filter(function (x) { return x.id === itemId; })[0];
    if (!i) return;
    activeDetail = { type: 'inventory', id: itemId };

    var fullName = i.projectName + (i.unitNo ? ' ' + i.unitNo : '');
    document.getElementById('ridPageTitle').textContent = fullName;
    document.getElementById('ridAvatar').textContent = initials(i.projectName);
    document.getElementById('ridAvatar').style.background = avatarColor(i.projectName);
    document.getElementById('ridName').textContent = fullName;
    document.getElementById('ridStatus').innerHTML = '<span class="status-pill ' + reStatusClass(i.status) + '">' + i.status + '</span>';
    document.getElementById('ridPrice').textContent = reMoney(i.price);
    document.getElementById('ridArea').textContent = i.areaSqft ? Number(i.areaSqft).toLocaleString() + ' sqft' : '—';
    document.getElementById('ridType').textContent = i.type || '—';
    document.getElementById('ridLocation').textContent = i.location || '—';
    document.getElementById('ridUnitNo').textContent = i.unitNo || '—';
    document.getElementById('ridBedrooms').textContent = i.bedrooms != null ? i.bedrooms : '—';
    document.getElementById('ridBathrooms').textContent = i.bathrooms != null ? i.bathrooms : '—';
    document.getElementById('ridPossession').textContent = i.possessionDate || '—';
    document.getElementById('ridAmenities').textContent = i.amenities || 'No amenities listed.';
    document.getElementById('ridDescription').textContent = i.description || 'No description on file.';

    var mapQuery = (i.latitude != null && i.longitude != null)
      ? (i.latitude + ',' + i.longitude)
      : [i.location, i.projectName].filter(Boolean).join(', ');
    document.getElementById('ridMap').src = mapQuery
      ? 'https://maps.google.com/maps?q=' + encodeURIComponent(mapQuery) + '&z=14&output=embed'
      : 'https://maps.google.com/maps?q=India&z=4&output=embed';

    var interested = currentData.leads.filter(function (l) {
      return l.propertyInterest && i.projectName && l.propertyInterest.toLowerCase().indexOf(i.projectName.toLowerCase()) !== -1;
    });
    document.getElementById('ridLeadsList').innerHTML = interested.map(function (l) {
      return '<div class="mini-lead-row"><div><a href="#" data-open-lead="' + l.id + '" style="font-weight:600;color:var(--text);">' + l.name + '</a>' +
        '<div class="meta">' + (l.propertyInterest || '') + '</div></div>' +
        '<span class="status-pill ' + reStatusClass(l.status) + '">' + l.status + '</span></div>';
    }).join('') || '<div class="empty-note">No leads currently linked to this unit.</div>';
    bindOpenLeadLinks('ridLeadsList');

    showSection('viewReInventoryDetail');
    renderReTimeline('ridTimeline', '/api/accounts/' + accountId + '/re/inventory/' + itemId + '/activity', 'No activity for this unit yet.');
  }

  document.getElementById('ridEditBtn').addEventListener('click', function () {
    if (activeDetail && activeDetail.type === 'inventory') openReInventoryModal(activeDetail.id);
  });
  document.getElementById('ridBack').addEventListener('click', function (e) {
    e.preventDefault(); activeDetail = null; switchView('inventory');
  });

  function render(data) {
    currentData = data;
    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('dashboardContent').style.display = '';

    var isSuperAdminViewer = data.viewerRole === 'super_admin';
    var viewerIsPrimary = !!data.viewerIsPrimary;
    var isRealEstate = data.moduleKind === 'real_estate';

    // Real Estate CRM gets a light theme; everything else (Sales, the
    // topbar, modals, buttons) stays exactly as-is — re-light only
    // overrides CSS variables, it doesn't change any component.
    document.body.classList.toggle('re-light', isRealEstate);
    var topbarLogo = document.getElementById('topbarLogo');
    if (topbarLogo) topbarLogo.src = isRealEstate ? 'logo-light.svg' : 'logo.svg';

    // Which sidebar tabs apply depends on the account's module — Home/
    // Leads-Kanban is Sales-only, Dashboard/Leads/Brokers/Inventory/
    // Accounting is Real Estate-only. Team is shared by every module.
    document.querySelectorAll('.side-nav-item[data-view="home"]').forEach(function (el) { el.style.display = isRealEstate ? 'none' : ''; });
    document.querySelectorAll('.side-nav-item[data-realestate]').forEach(function (el) { el.style.display = isRealEstate ? '' : 'none'; });
    if (isRealEstate && !initialViewSet) {
      switchView('dashboard');
      initialViewSet = true;
    }

    renderMyTasks(data);

    if (isRealEstate) {
      renderRealEstate(data);
    } else {
      var expired = data.expiresAt && data.expiresAt < Date.now();
      document.getElementById('licenseBar').innerHTML =
        '<b style="color:var(--text);">' + (data.typeLabel || 'Platform') + '</b>' +
        ' &nbsp;·&nbsp; License <span style="font-family:\'JetBrains Mono\',monospace;color:var(--cyan);">' + (data.licenseNumber || '—') + '</span>' +
        ' &nbsp;·&nbsp; Started ' + fmtDate(data.startsAt) +
        ' &nbsp;·&nbsp; <span style="color:' + (expired ? 'var(--warn)' : 'var(--faint)') + ';">' + (expired ? 'Expired ' : 'Expires ') + fmtDate(data.expiresAt) + '</span>' +
        (data.licenseTermMonths ? ' (' + data.licenseTermMonths + '-month term)' : '');

      var leadsPanel = document.getElementById('leadsPanel');

      if (data.moduleKind === 'counters') {
        leadsPanel.style.display = 'none';

        var metricGrid = document.getElementById('pipelineGrid');
        metricGrid.innerHTML = data.metrics.map(function (m) {
          return metricCard(m.label, (data.counters[m.key] || 0).toLocaleString());
        }).join('');
      } else {
        leadsPanel.style.display = '';
        document.getElementById('leadsTitle').textContent = data.pipelineLabel;
        var totalValue = data.pipelineValue ? Object.keys(data.pipelineValue).reduce(function (sum, k) { return sum + data.pipelineValue[k]; }, 0) : 0;
        document.getElementById('leadsSub').textContent = data.leads.length + ' total' + (totalValue ? ' · $' + totalValue.toLocaleString() + ' pipeline value' : '');

        document.getElementById('pipelineGrid').innerHTML = data.statuses.map(function (s) {
          return metricCard(s, data.pipeline[s] || 0, STATUS_CLASS[s]);
        }).join('');

        renderKanban(data);
        renderLeadsList(data);
        setLeadsView(leadsViewMode);
      }

      renderInaFeed(data);

      document.getElementById('actionsRow').innerHTML = data.actionsAvailable.map(function (a, i) {
        return '<button class="action-btn' + (i === 0 ? ' primary' : '') + '" data-action="' + a.key + '"' + (data.status === 'suspended' ? ' disabled' : '') + '>' + a.icon + ' ' + a.label + '</button>';
      }).join('');

      var activityPanel = document.getElementById('activityPanel');
      if (viewerIsPrimary) {
        activityPanel.style.display = '';
        document.getElementById('activityList').innerHTML = data.activity.map(function (item) {
          return '<div class="activity-item">' + item.text +
            '<div class="when">' + timeAgo(item.at) + (item.actor ? ' · ' + item.actor : '') + '</div></div>';
        }).join('') || '<div class="empty-note">No activity yet.</div>';
      } else {
        activityPanel.style.display = 'none';
      }

      document.getElementById('creditsValue').textContent = data.creditsUsed.toLocaleString() + ' / ' + data.creditLimit.toLocaleString();
    }

    // Non-primary team members get a plain CRM: no Team tab, no Activity
    // feed (that's for the customer admin only), fewer automations.
    var teamNavItem = document.querySelector('.side-nav-item[data-view="team"]');
    if (teamNavItem) teamNavItem.style.display = viewerIsPrimary ? '' : 'none';

    fillFilterOptionsPlain('teamFilterRole', ['Admin', 'User']);
    renderTeamTable();

    var newUserBtn = document.getElementById('newUserBtn');
    var capNote = document.getElementById('teamCapNote');
    if (!viewerIsPrimary) {
      newUserBtn.style.display = 'none';
      capNote.innerHTML = '';
    } else if (data.team.length >= 3 && !isSuperAdminViewer) {
      newUserBtn.disabled = true;
      capNote.innerHTML = '<div class="team-full-note">This account has the max of 3 users. Contact a super admin to add more.</div>';
    } else {
      newUserBtn.style.display = '';
      newUserBtn.disabled = false;
      capNote.innerHTML = '';
    }

    document.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-action');
        var originalHtml = btn.innerHTML;
        document.querySelectorAll('[data-action]').forEach(function (b) { b.disabled = true; });
        btn.innerHTML = '<span class="spinner"></span> Running...';
        fetch('/api/accounts/' + accountId + '/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: key })
        }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
          .then(function (r) {
            if (!r.ok) {
              document.querySelectorAll('[data-action]').forEach(function (b) { b.disabled = false; });
              btn.innerHTML = originalHtml;
              showToast(r.d.error);
              return;
            }
            showToast(r.d.summary + ' (' + r.d.creditsSpent + ' credits)');
            loadAccount();
          });
      });
    });

    // If a lead/broker/inventory detail view is open, refresh it in place
    // with the freshly-loaded data instead of leaving it stale.
    if (activeDetail) {
      if (activeDetail.type === 'lead') openReLeadDetail(activeDetail.id);
      else if (activeDetail.type === 'broker') openReBrokerDetail(activeDetail.id);
      else if (activeDetail.type === 'inventory') openReInventoryDetail(activeDetail.id);
    }

    var reportsSection = document.getElementById('viewReports');
    if (reportsSection && reportsSection.classList.contains('active')) loadMonthlyReport();
  }

  fetch('/api/me').then(function (res) {
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('redirect'); }
    return res.json();
  }).then(function (data) {
    me = data;
    document.getElementById('whoName').textContent = me.name;

    var requested = params.get('account');
    if (me.role === 'super_admin') {
      if (!requested) { window.location.href = '/super-admin.html'; return; }
      accountId = requested;
      document.getElementById('roleBadge').textContent = 'Super admin';
      var banner = document.getElementById('impersonateBanner');
      banner.style.display = 'flex';
      banner.innerHTML = '<span>Viewing as super admin — actions here are logged against this account.</span><a class="link-btn" href="/super-admin.html">← Back to overview</a>';
    } else {
      accountId = me.accountId;
      document.getElementById('roleBadge').textContent = 'Admin';
    }
    loadAccount();
  }).catch(function (err) {
    if (err.message !== 'redirect') console.error(err);
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST' }).then(function () { window.location.href = '/login.html'; });
  });

  // ---- sidebar navigation ----
  function switchView(view) {
    document.querySelectorAll('.side-nav-item').forEach(function (item) {
      item.classList.toggle('active', item.getAttribute('data-view') === view);
    });
    document.querySelectorAll('.view-section').forEach(function (section) {
      section.classList.toggle('active', section.id === 'view' + view.charAt(0).toUpperCase() + view.slice(1));
    });
    updateInaFloatVisibility(view === 'dashboard');
    if (view === 'reports') loadMonthlyReport();
    if (view === 'whatsapp') loadWhatsAppTab();
  }

  document.querySelectorAll('.side-nav-item').forEach(function (item) {
    item.addEventListener('click', function () {
      switchView(item.getAttribute('data-view'));
    });
  });

  document.getElementById('sideToggle').addEventListener('click', function () {
    var shell = document.getElementById('shell');
    var collapsed = shell.classList.toggle('collapsed');
    document.getElementById('sideToggle').textContent = collapsed ? '⟩⟩' : '⟨⟨';
  });

  // ---- Ina agent: floating widget ----
  document.getElementById('reInaFloatToggle').addEventListener('click', function () {
    var win = document.getElementById('reInaFloatWindow');
    win.style.display = win.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('reInaFloatClose').addEventListener('click', function () {
    document.getElementById('reInaFloatWindow').style.display = 'none';
  });
})();
