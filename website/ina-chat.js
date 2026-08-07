/* ============================================================
   Ina — KineSys chat widget
   Self-injecting: just include ina-chat.css + this script on any
   page and the CTA bar + chat window build themselves.

   IMPORTANT — connecting a real LLM:
   Right now getInaReply() below is a MOCK responder (keyword
   matching against the KineSys knowledge base). It is safe to
   ship as-is since it needs no API key. Once you have a backend
   (a small serverless/Node function that holds your LLM key),
   replace the body of getInaReply() with something like:

     async function getInaReply(userText, history) {
       const res = await fetch('/api/chat', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ message: userText, history })
       });
       const data = await res.json();
       return data.reply; // markdown/mermaid in the reply renders automatically
     }

   Never put an LLM API key in this file — it ships to every
   visitor's browser in plain text.
   ============================================================ */

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DISCLAIMER = '<span>&#128737; Secure</span><span>&middot;</span><span>Policy-aware</span><span>&middot;</span><span>Voice enabled</span><span>&middot;</span>';

  const QUICK_ACTIONS = [
    { id: 'solve', icon: '🧩', label: 'Turn My Problem Into a Solution' },
    { id: 'timeline', icon: '⏱️', label: 'Effort & Time Estimates for This Process' },
    { id: 'connect', icon: '📧', label: 'Email Raunak & Inacio' },
    { id: 'about', icon: '💬', label: 'Ask About KineSys' }
  ];

  // Small inline icon set for the input row (outline style,
  // inherits currentColor so it themes with the buttons around it).
  const MIC_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
  const SPEAKER_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
  const ATTACH_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
  const SEND_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';

  // Real agent backend — your Node/Express server (server.js) in
  // EKB-Chatbot-Demo-Agent-63298, which forwards to your Automation
  // Anywhere / EKB agent via ChatSDK. Run `npm start` in that folder
  // first. Change this URL if the backend runs somewhere else, or to
  // a relative '/api/chat' once this site is served by that same
  // Express server (see server.js's express.static line).
  const BACKEND_CHAT_URL = 'http://localhost:3001/api/chat';
  const BACKEND_NOTIFY_URL = 'http://localhost:3001/api/notify-visitor';
  const BACKEND_TRANSCRIPT_URL = 'http://localhost:3001/api/send-transcript';

  // Simple spam guard: at most 5 sends (typed messages, quick
  // actions, or follow-up chips) per rolling 60-second window.
  const MAX_MSGS_PER_MIN = 5;
  let sendTimestamps = [];

  // Guards so the transcript email only ever fires once per session,
  // no matter which of close/clear/tab-close triggers it first.
  let transcriptEmailed = false;

  const HANDOFF_EMAIL = 'hello@kinesys.io';
  const RAUNAK_PHONE = '+971 50 585 3891';
  const INACIO_PHONE_UAE = '+971 58 584 6540';
  const INACIO_PHONE_IN = '+91 96041 39376';

  // ---------------------------------------------------------
  // State — intentionally NOT persisted. Every full page load
  // (including a refresh) starts a brand-new chat: fresh state
  // object, mandatory intake gate shown again, nothing carried
  // over. visitor = { name, contact } captured by that gate.
  // ---------------------------------------------------------
  let state = { opened: false, messages: [], mode: null, lead: {}, visitor: null, pendingAction: null, barMinimized: false, pendingBarMessage: null, sessionId: null, backendChatId: null };
  function saveState() { /* no-op: nothing persists across a reload by design */ }

  // ---------------------------------------------------------
  // Build DOM — CTA bar (closed state) + chat window (open state).
  // The bar's layout/placement mirrors the "Ask [Agent] anything"
  // pattern: icon left, headline + subtext middle, launch button right.
  // ---------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'ina-root';
  root.innerHTML = `
    <div class="ina-bar" id="ina-bar">
      <div class="ina-bar-icon" id="ina-bar-icon"><img src="logo.svg" alt=""></div>
      <div class="ina-bar-text" id="ina-bar-textcol">
        <div class="ina-bar-title-row">
          <span class="ina-bar-name">Ina</span>
          <span class="ina-bar-agent-badge">AI Agent</span>
          <span class="ina-bar-online"><span class="ina-bar-online-dot"></span>Online</span>
        </div>
        <div class="ina-bar-sub">Get instant help designing a solution or asking about KineSys</div>
      </div>
      <div class="ina-bar-inputwrap" id="ina-bar-inputwrap">
        <span class="ina-bar-input" id="ina-bar-input">Describe a problem to solve&hellip;</span>
        <button class="ina-bar-go" id="ina-bar-go" type="button">GO</button>
      </div>
      <button class="ina-bar-minimize" id="ina-bar-minimize" type="button" aria-label="Minimize">&#8211;</button>
    </div>
    <button class="ina-mini ina-hidden" id="ina-mini" aria-label="Reopen Ina, the KineSys AI agent">
      <img src="logo.svg" alt="">
      <span class="ina-mini-dot"></span>
    </button>
    <div class="ina-window" id="ina-window" role="dialog" aria-label="Chat with Ina">
      <div class="ina-header">
        <img src="logo.svg" alt="">
        <div class="ina-header-text">
          <div class="ina-name"><span class="ina-status-dot"></span>Ina</div>
          <div class="ina-sub">KineSys Agent</div>
        </div>
        <button class="ina-header-clear-btn" id="ina-clear-btn" type="button">Clear Chat</button>
        <div class="ina-menu-wrap">
          <button class="ina-header-icon-btn" id="ina-more-btn" type="button" title="More options" aria-label="More options">&#8942;</button>
          <div class="ina-more-menu ina-hidden" id="ina-more-menu">
            <button type="button" id="ina-menu-download">Download transcript</button>
            <button type="button" id="ina-menu-clear-close">Clear and close chat</button>
          </div>
        </div>
        <button class="ina-header-icon-btn" id="ina-header-close" type="button" aria-label="Minimize">&#8722;</button>
      </div>
      <div class="ina-info-bar ina-hidden" id="ina-info-bar">
        <div>
          <div class="ina-info-title">New conversation</div>
          <div class="ina-info-meta" id="ina-info-meta">Fresh session</div>
        </div>
        <div class="ina-info-online"><span class="ina-info-online-dot"></span>Online</div>
      </div>
      <div class="ina-gate" id="ina-gate">
        <div class="ina-gate-icon"><img src="logo.svg" alt=""></div>
        <h3 class="ina-gate-title">Hey, I'm Ina &#128075;</h3>
        <p class="ina-gate-sub">Tell me who you are and how to reach you, then let's dig into your problem.</p>
        <div class="ina-gate-field">
          <span class="ina-gate-field-icon">&#128100;</span>
          <input class="ina-gate-input" id="ina-gate-name" type="text" placeholder="Your name" autocomplete="off">
        </div>
        <div class="ina-gate-field">
          <span class="ina-gate-field-icon">&#9993;</span>
          <input class="ina-gate-input" id="ina-gate-contact" type="text" placeholder="Email or phone number" autocomplete="off">
        </div>
        <div class="ina-gate-error" id="ina-gate-error"></div>
        <button class="ina-gate-submit" id="ina-gate-submit">Start Chatting &rarr;</button>
        <p class="ina-gate-trust">&#128274; Just so our team can follow up with you &mdash; never shared or sold.</p>
      </div>
      <div class="ina-messages ina-hidden" id="ina-messages">
        <div class="ina-intro" id="ina-intro">
          <img src="logo.svg" alt="" class="ina-intro-logo">
          <div class="ina-intro-title">Ask Ina<br><span>anything.</span></div>
          <div class="ina-intro-sub">Ask about turning a problem into a solution, project timelines, KineSys offerings, pricing, and more.</div>
        </div>
      </div>
      <div class="ina-quickbar ina-hidden" id="ina-quickbar"></div>
      <div class="ina-input-row ina-hidden" id="ina-input-row">
        <div class="ina-input-avatar"><img src="logo.svg" alt=""></div>
        <input class="ina-input" id="ina-input" type="text" placeholder="Type your message..." autocomplete="off">
        <button class="ina-input-icon-btn" id="ina-mic-btn" type="button" title="Voice input (coming soon)" aria-label="Voice input">${MIC_SVG}</button>
        <button class="ina-input-icon-btn" id="ina-speaker-btn" type="button" title="Voice reply (coming soon)" aria-label="Voice reply">${SPEAKER_SVG}</button>
        <button class="ina-input-icon-btn" id="ina-attach-btn" type="button" title="Attach file (coming soon)" aria-label="Attach file">${ATTACH_SVG}</button>
        <button class="ina-send" id="ina-send" type="button" aria-label="Send">${SEND_SVG}</button>
      </div>
      <div class="ina-disclaimer-bar ina-hidden" id="ina-disclaimer-bar">${DISCLAIMER}</div>
    </div>
  `;
  document.body.appendChild(root);

  const barEl = document.getElementById('ina-bar');
  const barIconEl = document.getElementById('ina-bar-icon');
  const barTextColEl = document.getElementById('ina-bar-textcol');
  const barInputWrap = document.getElementById('ina-bar-inputwrap');
  const barGoBtn = document.getElementById('ina-bar-go');
  const barMinimizeBtn = document.getElementById('ina-bar-minimize');
  const miniEl = document.getElementById('ina-mini');
  const windowEl = document.getElementById('ina-window');
  const messagesEl = document.getElementById('ina-messages');
  const inputRowEl = document.getElementById('ina-input-row');
  const disclaimerEl = document.getElementById('ina-disclaimer-bar');
  const inputEl = document.getElementById('ina-input');
  const sendBtn = document.getElementById('ina-send');
  const headerClose = document.getElementById('ina-header-close');
  const clearBtn = document.getElementById('ina-clear-btn');
  const moreBtn = document.getElementById('ina-more-btn');
  const moreMenu = document.getElementById('ina-more-menu');
  const menuDownloadBtn = document.getElementById('ina-menu-download');
  const menuClearCloseBtn = document.getElementById('ina-menu-clear-close');
  const infoBarEl = document.getElementById('ina-info-bar');
  const infoMetaEl = document.getElementById('ina-info-meta');
  const introEl = document.getElementById('ina-intro');
  const quickBarEl = document.getElementById('ina-quickbar');
  const gateEl = document.getElementById('ina-gate');
  const gateNameInput = document.getElementById('ina-gate-name');
  const gateContactInput = document.getElementById('ina-gate-contact');
  const gateError = document.getElementById('ina-gate-error');
  const gateSubmitBtn = document.getElementById('ina-gate-submit');

  // ---------------------------------------------------------
  // Markdown / table / Mermaid rendering for bot messages.
  // A real LLM will often reply with **bold**, lists, pipe
  // tables, and ```mermaid fenced blocks — all of that renders
  // to real HTML/diagrams here instead of showing as raw text.
  // ---------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function mdTable(block) {
    const lines = block.trim().split('\n').filter((l) => l.trim());
    if (lines.length < 2) return block;
    const sep = lines[1];
    if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(sep.trim())) return block;
    const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const head = splitRow(lines[0]);
    const rows = lines.slice(2).map(splitRow);
    let html = '<div class="ina-table-wrap"><table class="ina-table"><thead><tr>';
    head.forEach((c) => { html += '<th>' + c + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach((r) => {
      html += '<tr>';
      r.forEach((c) => { html += '<td>' + c + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function mdLists(text) {
    const lines = text.split('\n');
    const out = [];
    let mode = null;
    lines.forEach((line) => {
      const ul = /^\s*[-*]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (ul) {
        if (mode !== 'ul') { if (mode) out.push('</' + mode + '>'); out.push('<ul>'); mode = 'ul'; }
        out.push('<li>' + ul[1] + '</li>');
      } else if (ol) {
        if (mode !== 'ol') { if (mode) out.push('</' + mode + '>'); out.push('<ol>'); mode = 'ol'; }
        out.push('<li>' + ol[1] + '</li>');
      } else {
        if (mode) { out.push('</' + mode + '>'); mode = null; }
        out.push(line);
      }
    });
    if (mode) out.push('</' + mode + '>');
    return out.join('\n');
  }

  function mdParagraphs(text) {
    return text.split(/\n{2,}/).map((block) => {
      const t = block.trim();
      if (!t) return '';
      if (/^<(ul|ol|div|table|pre)/i.test(t)) return t;
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
  }

  function renderMarkdown(raw) {
    let text = escapeHtml(raw);
    const blocks = [];
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => {
      blocks.push({ lang: (lang || '').toLowerCase().trim(), code: code.replace(/\n$/, '') });
      return '@@INA_BLOCK_' + (blocks.length - 1) + '@@';
    });
    text = text.replace(/((?:^\|.*\|[ \t]*$\n?)+)/gm, mdTable);
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    text = mdLists(text);
    text = mdParagraphs(text);
    text = text.replace(/@@INA_BLOCK_(\d+)@@/g, (m, idx) => {
      const b = blocks[+idx];
      if (b.lang === 'mermaid') return '<div class="ina-mermaid">' + b.code + '</div>';
      return '<div class="ina-code-wrap"><button type="button" class="ina-copy-btn">Copy</button><pre class="ina-code-block"><code>' + b.code + '</code></pre></div>';
    });
    return text;
  }

  let mermaidPromise = null;
  function ensureMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (mermaidPromise) return mermaidPromise;
    mermaidPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
      s.onload = () => {
        try {
          window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
          resolve(window.mermaid);
        } catch (e) { reject(e); }
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return mermaidPromise;
  }

  function renderMermaidIn(container) {
    const nodes = Array.from(container.querySelectorAll('.ina-mermaid'));
    if (!nodes.length) return;
    ensureMermaid().then((mermaid) => {
      mermaid.run({ nodes }).catch(() => {
        nodes.forEach((n) => { n.textContent = 'Diagram could not be rendered.'; });
      });
    }).catch(() => {
      nodes.forEach((n) => { n.textContent = 'Diagram could not be rendered (renderer failed to load).'; });
    });
  }

  function wireCopyButtons(container) {
    container.querySelectorAll('.ina-copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const codeEl = btn.parentElement.querySelector('code');
        const code = codeEl ? codeEl.textContent : '';
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(code).then(() => {
          const old = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = old; }, 1500);
        }).catch(() => {});
      });
    });
  }

  // ---------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------
  function renderAll() {
    Array.from(messagesEl.children).forEach((c) => { if (c !== introEl) c.remove(); });
    state.messages.forEach((m) => appendNode(renderMessage(m), false));
    updateIntroVisibility();
    scrollToBottom();
  }

  // Welcome/empty state — a big "Ask Ina anything." block with the
  // quick-prompt options, shown until the first message is sent
  // (mirrors the Travel Booking Copilot's intro screen).
  function updateIntroVisibility() {
    if (state.messages.length === 0) introEl.classList.remove('ina-hidden');
    else introEl.classList.add('ina-hidden');
  }

  // Quick-prompt bar — sits just above the input row and stays
  // visible for the whole conversation (not just the empty/welcome
  // state), so the shortcuts stay one click away at any point.
  function renderQuickBar() {
    quickBarEl.innerHTML = '';
    QUICK_ACTIONS.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ina-quickbar-btn';
      btn.innerHTML = `<span>${a.icon || '▸'}</span> ${a.label}`;
      btn.addEventListener('click', () => handleQuickAction(a.id));
      quickBarEl.appendChild(btn);
    });
  }
  renderQuickBar();

  // Session ID — a lightweight per-session identifier shown under
  // "New conversation" once the intake gate is passed, the same way
  // the Travel Booking Copilot surfaces its chatId.
  function genSessionId() {
    return 'INA-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  }
  function updateInfoBar() {
    infoMetaEl.textContent = state.sessionId ? ('Session ID: ' + state.sessionId + ' · Fresh session') : 'Fresh session';
  }

  function renderMessage(m) {
    if (m.type === 'quick-actions') {
      const wrap = document.createElement('div');
      wrap.className = 'ina-quick-actions ina-msg-in';
      m.actions.forEach((a) => {
        const btn = document.createElement('button');
        btn.className = 'ina-quick-btn';
        btn.type = 'button';
        btn.innerHTML = `<span class="ina-quick-btn-icon">${a.icon || '▸'}</span><span class="ina-quick-btn-label">${a.label}</span><span class="ina-quick-btn-arrow">→</span>`;
        btn.addEventListener('click', () => handleQuickAction(a.id));
        wrap.appendChild(btn);
      });
      return wrap;
    }
    if (m.type === 'reply-chips') {
      const wrap = document.createElement('div');
      wrap.className = 'ina-chip-row ina-msg-in';
      m.chips.forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ina-chip';
        btn.textContent = c;
        btn.addEventListener('click', () => sendChipReply(c));
        wrap.appendChild(btn);
      });
      return wrap;
    }
    if (m.type === 'handoff') {
      const el = document.createElement('div');
      el.className = 'ina-handoff ina-msg-in';
      el.innerHTML = m.html;
      return el;
    }
    const el = document.createElement('div');
    el.className = 'ina-msg ina-msg-in ' + (m.role === 'user' ? 'user' : 'bot');
    if (m.role === 'user') {
      el.textContent = m.text;
    } else {
      el.innerHTML = renderMarkdown(m.text);
      renderMermaidIn(el);
      wireCopyButtons(el);
    }
    return el;
  }

  function appendNode(node, scroll) {
    messagesEl.appendChild(node);
    if (scroll !== false) scrollToBottom();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function pushMessage(msg) {
    state.messages.push(msg);
    saveState();
    appendNode(renderMessage(msg));
    updateIntroVisibility();
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'ina-typing';
    el.id = 'ina-typing-indicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    appendNode(el);
    return el;
  }
  function hideTyping() {
    const el = document.getElementById('ina-typing-indicator');
    if (el) el.remove();
  }

  // ---------------------------------------------------------
  // Mandatory intake gate — every chat must start with a name +
  // a strictly-validated email or phone number before Ina will
  // talk, so every session leaves a contact record.
  // ---------------------------------------------------------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^\+?[0-9\s\-().]{7,20}$/;

  function isValidContact(text) {
    const t = text.trim();
    if (EMAIL_RE.test(t)) return true;
    if (PHONE_RE.test(t) && (t.match(/\d/g) || []).length >= 7) return true;
    return false;
  }

  function showGate() {
    gateEl.classList.remove('ina-hidden');
    infoBarEl.classList.add('ina-hidden');
    messagesEl.classList.add('ina-hidden');
    quickBarEl.classList.add('ina-hidden');
    inputRowEl.classList.add('ina-hidden');
    disclaimerEl.classList.add('ina-hidden');
  }
  function hideGateShowChat() {
    gateEl.classList.add('ina-hidden');
    infoBarEl.classList.remove('ina-hidden');
    messagesEl.classList.remove('ina-hidden');
    quickBarEl.classList.remove('ina-hidden');
    inputRowEl.classList.remove('ina-hidden');
    disclaimerEl.classList.remove('ina-hidden');
  }
  function syncGateVisibility() {
    if (!state.visitor) {
      showGate();
    } else {
      hideGateShowChat();
      renderAll();
    }
  }

  // Best-effort notification the moment a visitor submits the gate —
  // fires before there's necessarily any real conversation yet.
  function notifyNewVisitor() {
    fetch(BACKEND_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: state.visitor.name,
        contact: state.visitor.contact,
        startedAt: new Date().toLocaleString()
      })
    }).catch(() => { /* best-effort — don't bother the visitor if this fails */ });
  }

  function submitGate() {
    const name = gateNameInput.value.trim();
    const contact = gateContactInput.value.trim();
    if (!name) {
      gateError.textContent = 'Please enter your name.';
      return;
    }
    if (!isValidContact(contact)) {
      gateError.textContent = 'Enter a valid email address or phone number.';
      return;
    }
    gateError.textContent = '';
    state.visitor = { name, contact };
    state.sessionId = genSessionId();
    saveState();
    notifyNewVisitor();
    updateInfoBar();
    hideGateShowChat();
    updateIntroVisibility();
    if (state.pendingAction) {
      const action = state.pendingAction;
      state.pendingAction = null;
      saveState();
      setTimeout(() => handleQuickAction(action), 350);
    }
    if (state.pendingBarMessage) {
      const msg = state.pendingBarMessage;
      state.pendingBarMessage = null;
      saveState();
      setTimeout(() => sendChipReply(msg), 350);
      return;
    }
    setTimeout(() => inputEl.focus(), 150);
  }
  gateSubmitBtn.addEventListener('click', submitGate);
  gateContactInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGate(); });
  gateNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') gateContactInput.focus(); });

  // ---------------------------------------------------------
  // Open / close — the CTA bar and the chat window share the
  // same bottom anchor, so opening reads as the bar "expanding"
  // into the full conversation, closing collapses back to it.
  // ---------------------------------------------------------
  function openChat() {
    state.opened = true;
    state.barMinimized = false;
    saveState();
    barEl.classList.add('ina-hidden');
    miniEl.classList.add('ina-hidden');
    windowEl.classList.add('ina-open');
    setTimeout(() => {
      if (!state.visitor) gateNameInput.focus(); else inputEl.focus();
    }, 200);
  }
  function closeChat() {
    emailTranscriptIfNeeded();
    windowEl.classList.remove('ina-open');
    if (state.barMinimized) {
      miniEl.classList.remove('ina-hidden');
    } else {
      barEl.classList.remove('ina-hidden');
    }
  }
  function isOpen() { return windowEl.classList.contains('ina-open'); }

  function openIfClosed() {
    if (!isOpen()) openChat();
  }
  barIconEl.addEventListener('click', openIfClosed);
  barTextColEl.addEventListener('click', openIfClosed);
  miniEl.addEventListener('click', openIfClosed);
  headerClose.addEventListener('click', closeChat);

  // Minimize collapses the bar into a small floating bubble
  // instead of closing Ina outright.
  barMinimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.barMinimized = true;
    saveState();
    barEl.classList.add('ina-hidden');
    miniEl.classList.remove('ina-hidden');
  });

  // The inline "Describe a problem to solve..." field is a
  // display-only prompt, not a live text input — clicking it (or
  // the GO button) just opens the full chat window.
  barInputWrap.addEventListener('click', openIfClosed);
  barGoBtn.addEventListener('click', (e) => { e.stopPropagation(); openIfClosed(); });

  // ---------------------------------------------------------
  // Hero "Envision Your Solution" CTA — opens Ina straight into
  // the problem-to-solution flow instead of just scrolling down.
  // ---------------------------------------------------------
  const heroCta = document.getElementById('hero-solve-cta');
  if (heroCta) {
    heroCta.addEventListener('click', (e) => {
      e.preventDefault();
      openChat();
      if (state.visitor) {
        setTimeout(() => handleQuickAction('solve'), 350);
      } else {
        state.pendingAction = 'solve';
        saveState();
      }
    });
  }

  // Every fresh page load starts with the gate showing (no
  // persisted state to restore) and the window closed.
  syncGateVisibility();

  // ---------------------------------------------------------
  // Clear chat — wipes the conversation and re-shows the intake
  // gate so a brand-new visitor record is captured if they carry on.
  // ---------------------------------------------------------
  function clearChat() {
    emailTranscriptIfNeeded();
    state.messages = [];
    state.mode = null;
    state.lead = {};
    state.visitor = null;
    state.pendingAction = null;
    state.pendingBarMessage = null;
    state.sessionId = null;
    state.backendChatId = null;
    transcriptEmailed = false;
    updateInfoBar();
    renderAll();
    gateNameInput.value = '';
    gateContactInput.value = '';
    gateError.textContent = '';
    showGate();
    closeMoreMenu();
    setTimeout(() => gateNameInput.focus(), 100);
  }
  clearBtn.addEventListener('click', clearChat);

  // ---------------------------------------------------------
  // "More" menu — Download transcript / Clear and close chat,
  // mirroring the Travel Booking Copilot's ⋮ dropdown.
  // ---------------------------------------------------------
  function closeMoreMenu() {
    moreMenu.classList.add('ina-hidden');
  }
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle('ina-hidden');
  });
  document.addEventListener('click', (e) => {
    if (!moreMenu.classList.contains('ina-hidden') && !e.target.closest('.ina-menu-wrap')) {
      closeMoreMenu();
    }
  });
  menuDownloadBtn.addEventListener('click', () => {
    closeMoreMenu();
    downloadTranscript();
  });
  menuClearCloseBtn.addEventListener('click', () => {
    closeMoreMenu();
    clearChat();
    closeChat();
  });

  // ---------------------------------------------------------
  // Transcript text — shared by the download button and the
  // automatic "chat ended" email below, so the two never drift.
  // ---------------------------------------------------------
  function buildTranscriptText() {
    const lines = [];
    lines.push('Ina — KineSys chat transcript');
    lines.push(new Date().toString());
    if (state.visitor) {
      lines.push('Visitor: ' + state.visitor.name + ' (' + state.visitor.contact + ')');
    }
    if (state.sessionId) {
      lines.push('Session ID: ' + state.sessionId);
    }
    lines.push('');
    state.messages.forEach((m) => {
      if (m.type === 'quick-actions' || m.type === 'reply-chips') return;
      if (m.type === 'handoff') {
        lines.push('[Lead handoff card generated]');
        return;
      }
      const who = m.role === 'user' ? (state.visitor ? state.visitor.name : 'Visitor') : 'Ina';
      lines.push(who + ': ' + m.text);
    });
    return lines.join('\n');
  }

  function downloadTranscript() {
    if (!state.messages.length) return;
    const blob = new Blob([buildTranscriptText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ina-chat-transcript.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Fires once per session, the first time the visitor closes the
  // chat, clears it, or closes the tab — whichever comes first.
  // Skips silently if nothing was actually said, or the send fails.
  function emailTranscriptIfNeeded() {
    if (transcriptEmailed) return;
    if (!state.visitor || state.messages.length === 0) return;
    transcriptEmailed = true;
    fetch(BACKEND_TRANSCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: state.visitor.name,
        contact: state.visitor.contact,
        transcript: buildTranscriptText()
      })
    }).catch(() => { /* best-effort */ });
  }

  // Best-effort catch for visitors who just close the tab instead of
  // clicking the chat's own close button. sendBeacon fires reliably
  // even as the page is unloading, unlike a normal fetch().
  window.addEventListener('pagehide', () => {
    if (transcriptEmailed) return;
    if (!state.visitor || state.messages.length === 0) return;
    transcriptEmailed = true;
    const payload = JSON.stringify({
      name: state.visitor.name,
      contact: state.visitor.contact,
      transcript: buildTranscriptText()
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(BACKEND_TRANSCRIPT_URL, new Blob([payload], { type: 'application/json' }));
    }
  });

  // ---------------------------------------------------------
  // Spam guard — at most MAX_MSGS_PER_MIN sends per rolling
  // 60-second window. Returns true (and tells the visitor to
  // wait) if the limit has been hit.
  // ---------------------------------------------------------
  function isRateLimited() {
    const now = Date.now();
    sendTimestamps = sendTimestamps.filter((t) => now - t < 60000);
    if (sendTimestamps.length >= MAX_MSGS_PER_MIN) {
      const waitSec = Math.ceil((60000 - (now - sendTimestamps[0])) / 1000);
      pushMessage({
        role: 'bot',
        type: 'text',
        text: `You're sending messages a little too fast — that looks like spam. Please wait ${waitSec}s before sending another message.`
      });
      return true;
    }
    sendTimestamps.push(now);
    return false;
  }

  // ---------------------------------------------------------
  // Quick actions
  // ---------------------------------------------------------
  function handleQuickAction(id) {
    if (isRateLimited()) return;
    if (id === 'solve') {
      state.mode = 'solve';
      pushMessage({ role: 'user', type: 'text', text: 'Turn My Problem Into a Solution' });
      respond("Tell me what's slow, manual, or repetitive in your business right now — the more detail, the better the sketch.", () => {
        pushMessage({
          type: 'reply-chips',
          chips: ['It’s mostly manual data entry or paperwork', 'It’s customer conversations or support', 'Not sure yet, help me figure it out']
        });
      });
    } else if (id === 'timeline') {
      state.mode = 'timeline';
      pushMessage({ role: 'user', type: 'text', text: 'Effort & Time Estimates for This Process' });
      respond("Roughly: a single RPA bot or a narrowly-scoped AI agent usually ships in **2 to 4 weeks**. A multi-system integration or a fuller agent platform (think Mia or LoanIQ) runs **6 to 10 weeks**. Enterprise-wide rollouts can run longer depending on integrations. Tell me more about your problem and I can narrow that down.");
    } else if (id === 'connect') {
      state.mode = 'connect';
      state.lead = { name: state.visitor.name, contact: state.visitor.contact, step: 'who' };
      pushMessage({ role: 'user', type: 'text', text: 'Email Raunak & Inacio' });
      respond("I've already got your name and contact on file. Would you rather hear from Raunak (business, pricing, timelines), Inacio (technical), or either?");
    } else if (id === 'about') {
      state.mode = 'about';
      pushMessage({ role: 'user', type: 'text', text: 'Ask About KineSys' });
      respond("Ask away — offerings, tech stack, past work, the team, careers, or why we're called KineSys. What do you want to know?");
    }
    saveState();
  }

  function sendChipReply(text) {
    if (isRateLimited()) return;
    pushMessage({ role: 'user', type: 'text', text });
    if (state.mode === 'connect') {
      handleLeadCapture(text);
      return;
    }
    respondAsync(getInaReply(text));
  }

  // ---------------------------------------------------------
  // Send flow
  // ---------------------------------------------------------
  function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;
    if (isRateLimited()) return;
    inputEl.value = '';
    pushMessage({ role: 'user', type: 'text', text });

    if (state.mode === 'connect') {
      handleLeadCapture(text);
      return;
    }
    respondAsync(getInaReply(text));
  }

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  function respond(text, after) {
    showTyping();
    const delay = reduceMotion ? 50 : 550 + Math.min(text.length * 6, 700);
    setTimeout(() => {
      hideTyping();
      pushMessage({ role: 'bot', type: 'text', text });
      if (typeof after === 'function') after();
    }, delay);
  }

  // Like respond(), but the reply text comes from an async source
  // (the real agent call below) instead of a ready string. Shows
  // typing for at least a short minimum so it doesn't flash even
  // if the backend answers instantly.
  async function respondAsync(replyPromise, after) {
    showTyping();
    const minDelay = reduceMotion ? 50 : 400;
    const [text] = await Promise.all([
      replyPromise,
      new Promise((resolve) => setTimeout(resolve, minDelay))
    ]);
    hideTyping();
    pushMessage({ role: 'bot', type: 'text', text });
    if (typeof after === 'function') after();
  }

  // ---------------------------------------------------------
  // Lead capture (who -> confirm)
  // Name + contact are already on file from the intake gate.
  // Fully functional right now via a mailto handoff, no backend needed.
  // ---------------------------------------------------------
  function handleLeadCapture(text) {
    const lead = state.lead;
    if (lead.step === 'who') {
      lead.who = text;
      lead.step = 'done';
      state.mode = null;
      showTyping();
      setTimeout(() => {
        hideTyping();
        pushMessage({ role: 'bot', type: 'text', text: "Got it — here's a message ready to send our way:" });
        const subject = encodeURIComponent('New lead from Ina (' + lead.name + ')');
        const body = encodeURIComponent(
          'Name: ' + lead.name + '\n' +
          'Contact: ' + lead.contact + '\n' +
          'Prefers to hear from: ' + lead.who + '\n\n' +
          'Message: (add anything else here before sending)'
        );
        pushMessage({
          type: 'handoff',
          html: `Name: ${escapeHtml(lead.name)}<br>Contact: ${escapeHtml(lead.contact)}<br>Prefers: ${escapeHtml(lead.who)}` +
                `<br><a href="mailto:${HANDOFF_EMAIL}?subject=${subject}&body=${body}">Send this to KineSys &rarr;</a>` +
                `<br><span style="display:block;margin-top:8px;">Or call directly: ${RAUNAK_PHONE} (Raunak) &middot; ${INACIO_PHONE_UAE} / ${INACIO_PHONE_IN} (Inacio)</span>`
        });
      }, reduceMotion ? 50 : 500);
    }
    saveState();
  }

  // ---------------------------------------------------------
  // Real agent call — sends the visitor's message to your
  // Node/Express backend (server.js), which forwards it to your
  // Automation Anywhere / EKB agent via ChatSDK and returns the
  // agent's reply. Markdown, pipe tables, and ```mermaid blocks
  // in that reply render automatically via renderMarkdown() above.
  // Requires the backend running locally: `npm start` inside the
  // EKB-Chatbot-Demo-Agent-63298 folder (one level up from this site).
  // ---------------------------------------------------------
  async function getInaReply(userText) {
    try {
      const res = await fetch(BACKEND_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, chatId: state.backendChatId })
      });
      let data = {};
      try { data = await res.json(); } catch (e) { /* non-JSON response */ }
      if (!res.ok) {
        return "I couldn't reach the KineSys agent just now (" + (data.details || data.error || ('HTTP ' + res.status)) + "). Make sure the backend is running — `npm start` inside the EKB-Chatbot-Demo-Agent-63298 folder.";
      }
      if (data.chatId) state.backendChatId = data.chatId;
      return data.reply || "I didn't get a reply back from the agent — please try that again.";
    } catch (err) {
      return "I can't connect to the KineSys agent backend right now. Check that the server is running locally (`npm start` in EKB-Chatbot-Demo-Agent-63298) and reachable at " + BACKEND_CHAT_URL + ".";
    }
  }
})();
