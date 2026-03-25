// Morning Signal V2 — Editorial Review UI
// Vanilla JS for simplicity (no build step needed)

let currentCorrelationId = null;
let candidates = [];
let selections = { leadStory: null, quickHits: [], watchListItems: [] };

const API = '/api';

// --- Utility ---
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function setStatus(text) { document.getElementById('pipeline-status').textContent = text; }
function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error';
  el.textContent = msg;
  document.getElementById('main-content').prepend(el);
  setTimeout(() => el.remove(), 8000);
}

function badgeClass(role) {
  if (role === 'lead_story') return 'badge-lead';
  if (role === 'quick_hit') return 'badge-quick';
  if (role === 'watch_list') return 'badge-watch';
  return '';
}

function roleLabel(role) {
  if (role === 'lead_story') return 'Lead Story';
  if (role === 'quick_hit') return 'Quick Hit';
  if (role === 'watch_list') return 'Watch List';
  return role;
}

// --- Phase 1: Pipeline Start + Story Selection ---

async function startPipeline() {
  const btn = document.getElementById('start-btn');
  btn.disabled = true;
  btn.textContent = 'Starting...';
  setStatus('Starting pipeline...');

  try {
    const result = await api('POST', '/pipeline/start');
    currentCorrelationId = result.correlationId;
    setStatus(`Phase 1 — ${result.currentStage}`);

    // Poll until awaiting_editor
    await pollUntilReady();
    await loadCandidates();
    hide('start-screen');
    show('phase1-screen');
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Start Pipeline';
  }
}

async function resumeEdition() {
  const id = document.getElementById('resume-correlation-id').value.trim();
  if (!id) return showError('Enter a correlation ID');
  currentCorrelationId = id;

  try {
    const status = await api('GET', `/pipeline/${id}/status`);
    setStatus(`${status.currentStage}`);

    if (status.currentStage === 'awaiting_selection') {
      await loadCandidates();
      hide('start-screen');
      show('phase1-screen');
    } else if (status.currentStage === 'awaiting_review') {
      await loadDraft();
      hide('start-screen');
      show('phase2-screen');
    } else {
      showError(`Edition is in "${status.currentStage}" state`);
    }
  } catch (err) {
    showError(err.message);
  }
}

async function pollUntilReady() {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await api('GET', `/pipeline/${currentCorrelationId}/status`);
    setStatus(status.currentStage);
    if (status.status === 'awaiting_editor' || status.status === 'failed') return;
  }
}

async function loadCandidates() {
  const data = await api('GET', `/editorial/${currentCorrelationId}/candidates`);
  candidates = data.candidates;
  renderPhase1();
}

function renderPhase1() {
  const container = document.getElementById('phase1-screen');
  // Reset selections
  selections = { leadStory: null, quickHits: [], watchListItems: [] };

  let html = `
    <h2 style="margin-bottom:16px;">Phase 1: Story Selection</h2>
    <p style="margin-bottom:16px; color:#666;">Select stories, assign roles, and confirm your selections. The AI suggested roles are shown but you have final say.</p>

    <div class="card" style="margin-bottom:20px;">
      <h3>Custom Search</h3>
      <div class="input-group" style="margin-top:8px;">
        <input type="text" id="custom-search-input" placeholder="Enter search query..." />
        <button class="btn btn-secondary" onclick="runCustomSearch()">Search</button>
      </div>
      <h3 style="margin-top:12px;">Add Manual Story</h3>
      <div class="input-group" style="margin-top:8px;">
        <input type="text" id="manual-url-input" placeholder="Paste article URL..." />
        <button class="btn btn-secondary" onclick="addManualStory('url')">Add URL</button>
      </div>
      <div class="input-group">
        <input type="text" id="manual-desc-input" placeholder="Or describe a story topic..." />
        <button class="btn btn-secondary" onclick="addManualStory('desc')">Add Topic</button>
      </div>
    </div>

    <div id="candidates-list">
  `;

  for (const c of candidates) {
    const roleBadge = `<span class="badge ${badgeClass(c.suggestedRole)}">${roleLabel(c.suggestedRole)}</span>`;
    const manualBadge = c.isManualStory ? ' <span class="badge badge-manual">Manual</span>' : '';
    const sourceLinks = (c.sourceArticles || []).filter(a => a.id).map(a =>
      `<a href="${escapeHtml(a.url)}" target="_blank" style="color:#2563eb;font-size:13px;text-decoration:none;">${escapeHtml(a.title || a.source)}</a> <span style="color:#999;font-size:12px;">(${escapeHtml(a.source)})</span>`
    ).join('<br>');
    html += `
      <div class="card" id="candidate-${c.id}">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div>
            <h3>${c.headline} ${roleBadge}${manualBadge}</h3>
            <p>${c.narrativeSummary}</p>
            <span class="source-count">${c.sourceArticleCount} source article(s) · ${c.category}</span>
            ${sourceLinks ? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:#666;font-size:13px;">View source articles</summary><div style="margin-top:6px;line-height:1.8;">${sourceLinks}</div></details>` : ''}
          </div>
        </div>
        <div class="actions">
          <select class="role-select" id="role-${c.id}" onchange="updateSelection('${c.id}')">
            <option value="">— Skip —</option>
            <option value="lead_story" ${c.suggestedRole === 'lead_story' ? 'selected' : ''}>Lead Story</option>
            <option value="quick_hit" ${c.suggestedRole === 'quick_hit' ? 'selected' : ''}>Quick Hit</option>
            <option value="watch_list" ${c.suggestedRole === 'watch_list' ? 'selected' : ''}>Watch List</option>
          </select>
        </div>
      </div>
    `;
  }

  html += `
    </div>
    <div style="margin-top:20px; display:flex; gap:12px;">
      <button class="btn btn-primary" onclick="confirmSelections()" id="confirm-btn">Confirm Selections → Phase 2</button>
    </div>
  `;

  container.innerHTML = html;

  // Auto-select suggested roles
  for (const c of candidates) {
    updateSelection(c.id);
  }
}

function updateSelection(candidateId) {
  const role = document.getElementById(`role-${candidateId}`).value;
  const candidate = candidates.find(c => c.id === candidateId);
  if (!candidate) return;

  // Remove from all lists first
  selections.quickHits = selections.quickHits.filter(c => c.id !== candidateId);
  selections.watchListItems = selections.watchListItems.filter(c => c.id !== candidateId);
  if (selections.leadStory?.id === candidateId) selections.leadStory = null;

  if (role === 'lead_story') {
    // Only one lead story — swap if one already selected
    if (selections.leadStory) {
      const prevId = selections.leadStory.id;
      document.getElementById(`role-${prevId}`).value = 'quick_hit';
      selections.quickHits.push(selections.leadStory);
    }
    selections.leadStory = candidate;
  } else if (role === 'quick_hit') {
    selections.quickHits.push(candidate);
  } else if (role === 'watch_list') {
    selections.watchListItems.push(candidate);
  }
}

async function runCustomSearch() {
  const input = document.getElementById('custom-search-input');
  const queryText = input.value.trim();
  if (!queryText) return;

  try {
    setStatus('Running custom search — this may take a minute (searching + re-clustering)...');
    const data = await api('POST', `/editorial/${currentCorrelationId}/custom-search`, { queryText });
    candidates = data.candidates;
    renderPhase1();
    setStatus('Custom search complete — ' + (data.searchResult?.newArticles || 0) + ' new articles found, candidates updated');
  } catch (err) {
    showError('Custom search failed: ' + err.message);
  }
}

async function addManualStory(type) {
  try {
    let body;
    if (type === 'url') {
      const url = document.getElementById('manual-url-input').value.trim();
      if (!url) return;
      body = { url };
    } else {
      const description = document.getElementById('manual-desc-input').value.trim();
      if (!description) return;
      body = { description };
    }

    setStatus(type === 'url' ? 'Fetching article metadata...' : 'Adding manual story...');
    const data = await api('POST', `/editorial/${currentCorrelationId}/manual-story`, body);
    candidates = data.candidates;
    renderPhase1();
    setStatus('Manual story added — scroll down to see it');
  } catch (err) {
    showError('Failed to add story: ' + err.message);
  }
}

async function confirmSelections() {
  if (!selections.leadStory) return showError('Select at least one Lead Story');
  if (selections.quickHits.length === 0) return showError('Select at least one Quick Hit');

  const btn = document.getElementById('confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Writing stories...';
  setStatus('Phase 2 — Writing...');

  try {
    await api('POST', `/editorial/${currentCorrelationId}/select`, { selections });
    await pollUntilReady();
    await loadDraft();
    hide('phase1-screen');
    show('phase2-screen');
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Confirm Selections → Phase 2';
  }
}

// --- Phase 2: Content Review ---

async function loadDraft() {
  const data = await api('GET', `/editorial/${currentCorrelationId}/draft`);
  renderPhase2(data);
}

function renderPhase2(draft) {
  const container = document.getElementById('phase2-screen');
  setStatus('Phase 2 — Review');

  const costHtml = draft.costSummary ? `
    <div class="cost-bar">
      <div class="item"><span class="label">Search</span><span class="value">$${draft.costSummary.searchCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">Research</span><span class="value">$${draft.costSummary.researchCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">Writing</span><span class="value">$${draft.costSummary.writingCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">Subject Lines</span><span class="value">$${draft.costSummary.subjectLineCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">Total</span><span class="value ${draft.costSummary.isOverBudget ? 'over-budget' : ''}">$${draft.costSummary.totalCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">LLM Calls</span><span class="value">${draft.costSummary.llmCallCount}</span></div>
      <div class="item"><span class="label">Search Calls</span><span class="value">${draft.costSummary.searchApiCallCount}</span></div>
    </div>
  ` : '';

  // Subject line options
  const options = draft.subjectLineOptions || [];
  let subjectHtml = '<div class="subject-options">';
  for (let i = 0; i < options.length; i++) {
    const selected = options[i] === draft.selectedSubjectLine ? 'selected' : '';
    subjectHtml += `
      <label class="subject-option ${selected}" onclick="selectSubjectLine(this, '${options[i].replace(/'/g, "\\'")}')">
        <input type="radio" name="subject" ${selected ? 'checked' : ''} /> ${options[i]}
      </label>
    `;
  }
  subjectHtml += `
    <div class="input-group" style="margin-top:4px;">
      <input type="text" id="custom-subject" placeholder="Or write a custom subject line..." />
    </div>
  </div>`;

  let html = `
    <h2 style="margin-bottom:16px;">Phase 2: Content Review</h2>
    ${costHtml}

    <div class="card" style="margin-top:16px;">
      <h3>Subject Line</h3>
      ${subjectHtml}
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Newsletter Preview</h3>
      <div class="preview-toggle">
        <button class="btn btn-secondary" onclick="setPreviewMode('desktop')">Desktop</button>
        <button class="btn btn-secondary" onclick="setPreviewMode('mobile')">Mobile</button>
      </div>
      <div class="preview-frame">
        <iframe id="preview-iframe" style="width:100%; height:600px; border:none;"></iframe>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Sections</h3>
      <div id="sections-list"></div>
    </div>

    <div style="margin-top:20px; display:flex; gap:12px;">
      <button class="btn btn-success" onclick="approveNewsletter()">✓ Approve & Send</button>
      <button class="btn btn-danger" onclick="rejectNewsletter()">✗ Reject</button>
      <button class="btn btn-secondary" onclick="returnToPhase1()">← Back to Phase 1</button>
    </div>
  `;

  container.innerHTML = html;

  // Write newsletter HTML into iframe with target="_blank" on all links
  const iframe = document.getElementById('preview-iframe');
  if (iframe && draft.html) {
    const iframeHtml = draft.html.replace('<head>', '<head><base target="_blank">');
    iframe.srcdoc = iframeHtml;
  }

  // Render section cards
  if (draft.sectionMetadata) {
    const sectionsEl = document.getElementById('sections-list');
    let sectionsHtml = '';
    for (const section of draft.sectionMetadata) {
      sectionsHtml += `
        <div class="card section-card ${section.role}" style="margin-top:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <span class="badge ${badgeClass(section.role)}">${roleLabel(section.role)}</span>
              <strong style="margin-left:8px;">${section.headline}</strong>
              <span class="source-count" style="margin-left:8px;">${section.wordCount} words</span>
            </div>
          </div>
        </div>
      `;
    }
    sectionsEl.innerHTML = sectionsHtml;
  }
}

function escapeHtml(html) {
  return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function selectSubjectLine(el, line) {
  document.querySelectorAll('.subject-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  el.querySelector('input').checked = true;
}

function setPreviewMode(mode) {
  const iframe = document.getElementById('preview-iframe');
  iframe.style.width = mode === 'mobile' ? '375px' : '100%';
}

async function approveNewsletter() {
  if (!confirm('Send this newsletter to all active subscribers?')) return;

  const customSubject = document.getElementById('custom-subject')?.value.trim();
  const selectedRadio = document.querySelector('input[name="subject"]:checked');
  const subjectLine = customSubject || (selectedRadio ? selectedRadio.parentElement.textContent.trim() : null);

  try {
    setStatus('Delivering...');
    const result = await api('POST', `/editorial/${currentCorrelationId}/approve`, { subjectLine });
    setStatus('Delivered!');
    alert(`Newsletter delivered! Sent: ${result.deliveryReport.totalSent}, Failed: ${result.deliveryReport.failureCount}`);
  } catch (err) {
    showError(err.message);
  }
}

async function rejectNewsletter() {
  const feedback = prompt('Rejection feedback (optional):');
  try {
    await api('POST', `/editorial/${currentCorrelationId}/reject`, { feedback, returnToPhase1: false });
    setStatus('Rejected');
    alert('Newsletter rejected. You can start a new pipeline run.');
  } catch (err) {
    showError(err.message);
  }
}

async function returnToPhase1() {
  try {
    await api('POST', `/editorial/${currentCorrelationId}/reject`, { feedback: 'Returning to Phase 1', returnToPhase1: true });
    await loadCandidates();
    hide('phase2-screen');
    show('phase1-screen');
    setStatus('Phase 1 — Selection');
  } catch (err) {
    showError(err.message);
  }
}
