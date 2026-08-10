(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var errorMsg = document.getElementById('errorMsg');
  var btn = document.getElementById('loginBtn');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorMsg.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Logging in...';

    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || 'Login failed.');
        window.location.href = r.data.redirect;
      })
      .catch(function (err) {
        errorMsg.textContent = err.message;
        errorMsg.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Log in to InaIntelligence →';
      });
  });
})();
