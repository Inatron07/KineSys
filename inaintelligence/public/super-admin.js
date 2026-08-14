(function () {
  'use strict';

  // If this page is restored from the browser's back/forward cache (e.g.
  // hitting Back after logging out), force a real reload so the /api/me
  // check below runs again instead of showing the stale cached view.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) window.location.reload();
  });

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

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function metricCard(label, value, cls) {
    return '<div class="metric-card"><div class="label">' + label + '</div><div class="value' + (cls ? ' ' + cls : '') + '">' + value + '</div></div>';
  }

  function loadOverview() {
    fetch('/api/super-admin/overview').then(function (res) {
      if (res.status === 401) { window.location.href = '/login.html'; throw new Error('redirect'); }
      if (res.status === 403) { window.location.href = '/admin.html'; throw new Error('redirect'); }
      return res.json();
    }).then(function (data) {
      document.getElementById('pageLoading').style.display = 'none';
      document.getElementById('dashboardContent').style.display = '';

      document.getElementById('metricGrid').innerHTML =
        metricCard('Live accounts', data.liveAccounts + ' / ' + data.totalAccounts) +
        metricCard('Credits used (all-time)', data.totals.creditsUsed.toLocaleString()) +
        metricCard('Actions triggered', data.totals.actionsTriggered.toLocaleString()) +
        metricCard('Team members', data.totals.teamMembers);

      document.getElementById('accountsSub').textContent = data.totalAccounts + ' account' + (data.totalAccounts === 1 ? '' : 's');

      document.getElementById('accountsBody').innerHTML = data.accounts.map(function (a) {
        var moduleTag = a.moduleKind === 'counters'
          ? '<span class="brand-sep" style="font-family:\'JetBrains Mono\',monospace;font-size:9.5px;">ERP</span>'
          : '<span class="brand-sep" style="font-family:\'JetBrains Mono\',monospace;font-size:9.5px;">CRM</span>';
        var expired = a.expiresAt && a.expiresAt < Date.now();
        var licenseLine = '<div style="font-size:10px;color:' + (expired ? 'var(--warn)' : 'var(--faint)') + ';margin-top:3px;">' +
          (a.typeLabel || '') + ' · ' + (a.licenseNumber || 'no license') +
          ' · started ' + fmtDate(a.startsAt) + ' · ' + (expired ? 'expired ' : 'expires ') + fmtDate(a.expiresAt) +
          (a.licenseTermMonths ? ' (' + a.licenseTermMonths + '-month term)' : '') +
          '</div>';
        return '<tr>' +
          '<td>' + a.name + ' ' + moduleTag + licenseLine + '</td>' +
          '<td><span class="status-pill status-' + a.status + '">' + a.status + '</span></td>' +
          '<td>' + a.teamSize + '</td>' +
          '<td>' + a.creditsUsed.toLocaleString() + ' / <input class="mini-input" type="number" value="' + a.creditLimit + '" data-limit-for="' + a.id + '"></td>' +
          '<td>' + a.actionsTriggered + '</td>' +
          '<td>' + timeAgo(a.lastActive) + '</td>' +
          '<td style="white-space:nowrap;">' +
            '<a class="link-btn" href="/admin.html?account=' + a.id + '">View →</a> &nbsp; ' +
            '<button class="link-btn ' + (a.status === 'active' ? 'danger' : '') + '" data-toggle-for="' + a.id + '">' + (a.status === 'active' ? 'Suspend' : 'Reactivate') + '</button>' +
          '</td>' +
        '</tr>';
      }).join('') || '<tr><td colspan="7" class="empty-note">No accounts yet.</td></tr>';

      var activityHtml = function (items) {
        return items.map(function (item) {
          return '<div class="activity-item"><span class="acc-tag">' + item.accountName + '</span>' + item.text +
            '<div class="when">' + timeAgo(item.at) + '</div></div>';
        }).join('') || '<div class="empty-note">No activity yet.</div>';
      };
      document.getElementById('globalActivity').innerHTML = activityHtml(data.globalActivity);
      document.getElementById('globalActivityPreview').innerHTML = activityHtml(data.globalActivity.slice(0, 5));

      document.querySelectorAll('[data-limit-for]').forEach(function (input) {
        input.addEventListener('change', function () {
          var accountId = input.getAttribute('data-limit-for');
          fetch('/api/super-admin/accounts/' + accountId + '/credit-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creditLimit: Number(input.value) })
          }).then(function (r) { return r.json(); }).then(function () { showToast('Credit limit updated.'); });
        });
      });

      document.querySelectorAll('[data-toggle-for]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var accountId = btn.getAttribute('data-toggle-for');
          fetch('/api/super-admin/accounts/' + accountId + '/status', { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function () { showToast('Account status updated.'); loadOverview(); });
        });
      });
    }).catch(function (err) {
      if (err.message === 'redirect') return;
      console.error(err);
      document.getElementById('pageLoading').innerHTML = 'Couldn\'t load the console. Try refreshing the page.';
    });
  }

  var presets = [];
  var licenseTerms = [];

  function renderNewAccountForm() {
    var wrap = document.getElementById('newAccountFormWrap');
    var options = presets.map(function (p) { return '<option value="' + p.key + '">' + p.label + '</option>'; }).join('');
    var termOptions = licenseTerms.map(function (t) { return '<option value="' + t + '"' + (t === 12 ? ' selected' : '') + '>' + t + ' months</option>'; }).join('');
    wrap.innerHTML =
      '<div style="font-size:12.5px;font-weight:700;margin-bottom:4px;">New account</div>' +
      '<div style="font-size:11px;color:var(--faint);margin-bottom:16px;">Creates the account, its license, and its first admin login in one step.</div>' +

      '<div style="font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Account & license</div>' +
      '<div class="na-row" style="grid-template-columns:1.4fr 1fr 1fr;">' +
        '<div class="na-field"><label for="naName">Account name</label><input type="text" id="naName" placeholder="e.g. Sales — Marketing Team"></div>' +
        '<div class="na-field"><label for="naType">Module</label><select id="naType">' + options + '</select></div>' +
        '<div class="na-field"><label for="naTerm">License term</label><select id="naTerm">' + termOptions + '</select><div class="hint-line">License number is generated automatically.</div></div>' +
      '</div>' +

      '<div style="font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">First admin login</div>' +
      '<div class="na-row" style="grid-template-columns:1fr 1fr 1fr;">' +
        '<div class="na-field"><label for="naAdminName">Full name</label><input type="text" id="naAdminName" placeholder="e.g. Priya Sharma"></div>' +
        '<div class="na-field"><label for="naAdminUsername">Username (email)</label><input type="text" id="naAdminUsername" placeholder="priya@kinesys.net"></div>' +
        '<div class="na-field"><label for="naAdminPassword">Temporary password</label><input type="password" id="naAdminPassword" placeholder="At least 6 characters"></div>' +
      '</div>' +

      '<button class="btn btn-primary" id="naSubmit" style="padding:10px 20px;font-size:12.5px;">Create account</button>';

    document.getElementById('naSubmit').addEventListener('click', function () {
      var payload = {
        name: document.getElementById('naName').value.trim(),
        type: document.getElementById('naType').value,
        licenseTermMonths: Number(document.getElementById('naTerm').value),
        adminName: document.getElementById('naAdminName').value.trim(),
        adminUsername: document.getElementById('naAdminUsername').value.trim(),
        adminPassword: document.getElementById('naAdminPassword').value
      };
      if (!payload.name || !payload.adminName || !payload.adminUsername || !payload.adminPassword) {
        showToast('Fill in every field.');
        return;
      }
      var submitBtn = document.getElementById('naSubmit');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span> Creating...';
      fetch('/api/super-admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Create account';
          if (!r.ok) { showToast(r.d.error); return; }
          showToast('Account created — license ' + r.d.licenseNumber);
          ['naName', 'naAdminName', 'naAdminUsername', 'naAdminPassword'].forEach(function (fid) {
            document.getElementById(fid).value = '';
          });
          loadOverview();
          switchView('accounts');
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Create account';
          showToast('Something went wrong. Check the server logs.');
          console.error(err);
        });
    });
  }

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

  fetch('/api/me').then(function (res) {
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('redirect'); }
    return res.json();
  }).then(function (me) {
    if (me.role !== 'super_admin') { window.location.href = '/admin.html'; return; }
    document.getElementById('whoName').textContent = me.name;
    loadOverview();
    fetch('/api/super-admin/module-presets').then(function (r) { return r.json(); }).then(function (d) {
      presets = d.presets || [];
      licenseTerms = d.licenseTerms || [12, 18, 24, 36, 48];
      renderNewAccountForm();
    });
  }).catch(function (err) {
    if (err.message !== 'redirect') console.error(err);
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST' }).then(function () { window.location.href = '/login.html'; });
  });
})();
