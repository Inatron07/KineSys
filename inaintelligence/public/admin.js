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
      metricCard('Site visits', dash.siteVisits || 0) +
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

    document.getElementById('reLeadsSub').textContent = data.leads.length + ' total';
    document.getElementById('reLeadsBody').innerHTML = data.leads.map(function (l) {
      return '<tr><td>' + l.name + '</td><td>' + (l.propertyInterest || '—') + '</td>' +
        '<td>' + (l.broker || '<span style="color:var(--warn);">Unassigned</span>') + '</td>' +
        '<td><span class="status-pill ' + reStatusClass(l.status) + '">' + l.status + '</span></td>' +
        '<td>' + (l.nextFollowup || '—') + '</td>' +
        '<td style="text-align:right;"><button class="link-btn" data-re-edit-lead="' + l.id + '">Edit</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="empty-note">No leads yet.</td></tr>';
    document.querySelectorAll('[data-re-edit-lead]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReLeadModal(btn.getAttribute('data-re-edit-lead')); });
    });

    document.getElementById('reBrokersSub').textContent = data.brokers.length + (data.brokers.length === 1 ? ' broker' : ' brokers');
    document.getElementById('reBrokersList').innerHTML = data.brokers.map(function (b) {
      var pct = Math.round((b.achievedPct || 0) * 100);
      var fillClass = pct === 0 ? 'zero' : pct < 50 ? 'low' : '';
      return '<div class="re-broker-card">' +
        '<div class="row"><span class="name">' + b.name + '</span>' +
        '<span class="meta">' + (b.zone || '') + ' · <span class="status-pill ' + reStatusClass(b.status) + '">' + b.status + '</span> · <button class="link-btn" data-re-edit-broker="' + b.id + '">Edit</button></span></div>' +
        '<p class="target">Active leads: ' + (b.activeLeads || 0) + ' · Closed deals: ' + (b.closedDeals || 0) + ' · Target ' + reMoney(b.salesTarget) + ' · Achieved ' + reMoney(b.revenueAchieved) + '</p>' +
        '<div class="re-progress-track"><div class="re-progress-fill ' + fillClass + '" style="width:' + Math.min(pct, 100) + '%;"></div></div>' +
        '<p class="re-progress-pct">' + pct + '% of target</p>' +
        '</div>';
    }).join('') || '<div class="empty-note">No brokers yet.</div>';
    document.querySelectorAll('[data-re-edit-broker]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReBrokerModal(btn.getAttribute('data-re-edit-broker')); });
    });

    document.getElementById('reInventorySub').textContent = data.inventory.length + (data.inventory.length === 1 ? ' unit' : ' units');
    document.getElementById('reInventoryBody').innerHTML = data.inventory.map(function (i) {
      return '<tr><td>' + i.projectName + (i.unitNo ? ' ' + i.unitNo : '') + '</td><td>' + (i.type || '—') + '</td>' +
        '<td>' + (i.areaSqft ? Number(i.areaSqft).toLocaleString() + ' sqft' : '—') + '</td>' +
        '<td>' + reMoney(i.price) + '</td>' +
        '<td><span class="status-pill ' + reStatusClass(i.status) + '">' + i.status + '</span></td>' +
        '<td>' + (i.location || '—') + '</td>' +
        '<td style="text-align:right;"><button class="link-btn" data-re-edit-inv="' + i.id + '">Edit</button></td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty-note">No inventory yet.</td></tr>';
    document.querySelectorAll('[data-re-edit-inv]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReInventoryModal(btn.getAttribute('data-re-edit-inv')); });
    });

    document.getElementById('reAccountingSub').textContent = data.accounting.length + (data.accounting.length === 1 ? ' transaction' : ' transactions');
    document.getElementById('reAccountingBody').innerHTML = data.accounting.map(function (t) {
      return '<tr><td>' + (t.clientName || '—') + '</td><td>' + (t.property || '—') + '</td><td>' + (t.type || '—') + '</td>' +
        '<td>' + reMoney(t.amount) + '</td><td>' + (t.brokerName || '—') + '</td><td>' + (t.paymentMode || '—') + '</td>' +
        '<td><span class="status-pill ' + reStatusClass(t.status) + '">' + t.status + '</span></td>' +
        '<td style="text-align:right;"><button class="link-btn" data-re-edit-txn="' + t.id + '">Edit</button></td></tr>';
    }).join('') || '<tr><td colspan="8" class="empty-note">No transactions yet.</td></tr>';
    document.querySelectorAll('[data-re-edit-txn]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReAccountingModal(btn.getAttribute('data-re-edit-txn')); });
    });

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

  // ---- Real Estate CRM: add/edit modals ----
  var RE_LEAD_STATUSES = ['New', 'Contacted', 'Site Visit', 'Negotiation', 'Closed', 'Lost'];
  var RE_INVENTORY_STATUSES = ['Available', 'Reserved', 'Negotiation', 'Sold'];
  var RE_ACCOUNTING_STATUSES = ['Pending', 'Received'];
  var RE_BROKER_STATUSES = ['Active', 'Inactive'];

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
    document.getElementById('reLeadSource').value = l ? (l.source || '') : '';
    document.getElementById('reLeadBudget').value = l ? (l.budget || 0) : '';
    fillSelect(document.getElementById('reLeadStatus'), RE_LEAD_STATUSES, l ? l.status : 'New');
    var brokerOptions = '<option value="">Unassigned</option>' + (currentData.brokers || []).map(function (b) {
      return '<option value="' + b.id + '"' + (l && l.brokerId === b.id ? ' selected' : '') + '>' + b.name + '</option>';
    }).join('');
    document.getElementById('reLeadBroker').innerHTML = brokerOptions;
    document.getElementById('reLeadFollowup').value = l ? (l.nextFollowup || '') : '';
    document.getElementById('reLeadRemarks').value = l ? (l.remarks || '') : '';
    reLeadModal.classList.add('show');
  }

  document.getElementById('reAddLeadBtn').addEventListener('click', function () { openReLeadModal(null); });
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
      source: document.getElementById('reLeadSource').value.trim() || 'Manual entry',
      budget: Number(document.getElementById('reLeadBudget').value) || 0,
      status: document.getElementById('reLeadStatus').value,
      brokerId: document.getElementById('reLeadBroker').value || null,
      nextFollowup: document.getElementById('reLeadFollowup').value || null,
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
      revenueAchieved: Number(document.getElementById('reBrokerRevenue').value) || 0
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
      location: document.getElementById('reInvLocation').value.trim()
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

  function render(data) {
    currentData = data;
    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('dashboardContent').style.display = '';

    var isSuperAdminViewer = data.viewerRole === 'super_admin';
    var viewerIsPrimary = !!data.viewerIsPrimary;
    var isRealEstate = data.moduleKind === 'real_estate';

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

    document.getElementById('teamSub').textContent = data.team.length + (isSuperAdminViewer ? ' users' : ' / 3 users');
    document.getElementById('teamList').innerHTML = data.team.map(function (m) {
      return '<tr>' +
        '<td><div style="display:flex;align-items:center;gap:10px;">' +
          '<span class="avatar-circle" style="background:' + avatarColor(m.name) + ';">' + initials(m.name) + '</span>' +
          '<span>' + m.name + '<span class="role-tag role-tag-' + roleSlug(m.role) + '">' + (m.role || 'Sales Rep') + '</span></span>' +
        '</div></td>' +
        '<td style="color:var(--faint);">' + m.username + '</td>' +
        '<td style="text-align:right;"><button class="link-btn" data-view-user="' + m.id + '">View →</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="3" class="empty-note">No teammates yet.</td></tr>';

    document.querySelectorAll('[data-view-user]').forEach(function (btn) {
      btn.addEventListener('click', function () { openUserDetail(btn.getAttribute('data-view-user')); });
    });

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
})();
