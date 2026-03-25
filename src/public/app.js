// Morning Signal V2 — Three-Phase Editorial UI
// Phase 1: Story Selection (with editable headlines)
// Phase 2: Story Editing (edit text, regenerate)
// Phase 3: Newsletter Editing (theme, subject line, preview, approve)

let currentCorrelationId = null;
let candidates = [];
let selections = { leadStory: null, quickHits: [], watchListItems: [] };
let headlineOverrides = {}; // candidateId -> custom headline
let writtenSections = []; // loaded after Phase 1 confirms
let currentTheme = null;
let presetThemes = {};
let defaultTheme = {};

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
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function badgeClass(r) { return r==='lead_story'?'badge-lead':r==='quick_hit'?'badge-quick':r==='watch_list'?'badge-watch':''; }
function roleLabel(r) { return r==='lead_story'?'Lead Story':r==='quick_hit'?'Quick Hit':r==='watch_list'?'Watch List':r; }
function countWords(t) { return (t||'').replace(/<[^>]*>/g,'').trim().split(/\s+/).filter(w=>w.length>0).length; }

// Load themes on init
(async function() {
  try {
    const data = await api('GET', '/editorial/themes');
    presetThemes = data.presets;
    defaultTheme = data.default;
    currentTheme = { ...defaultTheme };
  } catch(e) { console.warn('Could not load themes'); }
})();

// === PIPELINE START ===
async function startPipeline() {
  const btn = document.getElementById('start-btn');
  btn.disabled = true; btn.textContent = 'Starting...';
  setStatus('Starting pipeline...');
  try {
    const result = await api('POST', '/pipeline/start');
    currentCorrelationId = result.correlationId;
    setStatus('Discovering articles...');
    await pollUntilReady();
    await loadCandidates();
    hide('start-screen'); show('phase1-screen');
  } catch (err) {
    showError(err.message); btn.disabled = false; btn.textContent = 'Start Pipeline';
  }
}

async function resumeEdition() {
  const id = document.getElementById('resume-correlation-id').value.trim();
  if (!id) return showError('Enter a correlation ID');
  currentCorrelationId = id;
  try {
    const status = await api('GET', `/pipeline/${id}/status`);
    setStatus(status.currentStage);
    if (status.currentStage === 'awaiting_selection') {
      await loadCandidates(); hide('start-screen'); show('phase1-screen');
    } else if (status.currentStage === 'awaiting_review') {
      await loadSections(); hide('start-screen'); show('phase2-screen');
    } else {
      showError(`Edition is in "${status.currentStage}" state`);
    }
  } catch (err) { showError(err.message); }
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
  headlineOverrides = {};
  renderPhase1();
}

// === PHASE 1: STORY SELECTION ===
function renderPhase1() {
  const container = document.getElementById('phase1-screen');
  selections = { leadStory: null, quickHits: [], watchListItems: [] };

  let html = `
    <div class="phase-bar">
      <div class="phase-step active">1. Select Stories</div>
      <div class="phase-step">2. Edit Stories</div>
      <div class="phase-step">3. Newsletter</div>
    </div>
    <h2 style="margin-bottom:16px;">Phase 1: Story Selection</h2>
    <p style="margin-bottom:16px;color:#666;">Select stories, assign roles, and optionally edit headlines. Click the headline text to change it.</p>
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
    <div id="candidates-list">`;

  for (const c of candidates) {
    const roleBadge = `<span class="badge ${badgeClass(c.suggestedRole)}">${roleLabel(c.suggestedRole)}</span>`;
    const manualBadge = c.isManualStory ? ' <span class="badge badge-manual">Manual</span>' : '';
    const sourceLinks = (c.sourceArticles || []).filter(a => a.id).map(a =>
      `<a href="${esc(a.url)}" target="_blank" style="color:#2563eb;font-size:13px;text-decoration:none;">${esc(a.title || a.source)}</a> <span style="color:#999;font-size:12px;">(${esc(a.source)})</span>`
    ).join('<br>');
    const currentHeadline = headlineOverrides[c.id] || c.headline;
    html += `
      <div class="card" id="candidate-${c.id}">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              ${roleBadge}${manualBadge}
            </div>
            <input type="text" class="headline-edit" id="headline-${c.id}" value="${esc(currentHeadline)}" onchange="headlineOverrides['${c.id}']=this.value" />
            <p>${c.narrativeSummary}</p>
            <span class="source-count">${c.sourceArticleCount} source article(s) · ${c.category}</span>
            ${sourceLinks ? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:#666;font-size:13px;">View source articles</summary><div style="margin-top:6px;line-height:1.8;">${sourceLinks}</div></details>` : ''}
          </div>
        </div>
        <div class="actions">
          <select class="role-select" id="role-${c.id}" onchange="updateSelection('${c.id}')">
            <option value="">— Skip —</option>
            <option value="lead_story" ${c.suggestedRole==='lead_story'?'selected':''}>Lead Story</option>
            <option value="quick_hit" ${c.suggestedRole==='quick_hit'?'selected':''}>Quick Hit</option>
            <option value="watch_list" ${c.suggestedRole==='watch_list'?'selected':''}>Watch List</option>
          </select>
        </div>
      </div>`;
  }

  html += `</div>
    <div style="margin-top:20px;display:flex;gap:12px;">
      <button class="btn btn-primary" onclick="confirmSelections()" id="confirm-btn">Confirm Selections → Write Stories</button>
    </div>`;
  container.innerHTML = html;
  for (const c of candidates) updateSelection(c.id);
}

function updateSelection(candidateId) {
  const role = document.getElementById(`role-${candidateId}`).value;
  const candidate = candidates.find(c => c.id === candidateId);
  if (!candidate) return;
  selections.quickHits = selections.quickHits.filter(c => c.id !== candidateId);
  selections.watchListItems = selections.watchListItems.filter(c => c.id !== candidateId);
  if (selections.leadStory?.id === candidateId) selections.leadStory = null;
  if (role === 'lead_story') {
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
  const q = input.value.trim(); if (!q) return;
  try {
    setStatus('Running custom search...');
    const data = await api('POST', `/editorial/${currentCorrelationId}/custom-search`, { queryText: q });
    candidates = data.candidates; renderPhase1();
    setStatus('Custom search complete — ' + (data.searchResult?.newArticles || 0) + ' new articles found');
  } catch (err) { showError('Custom search failed: ' + err.message); }
}

async function addManualStory(type) {
  try {
    let body;
    if (type === 'url') { const u = document.getElementById('manual-url-input').value.trim(); if (!u) return; body = { url: u }; }
    else { const d = document.getElementById('manual-desc-input').value.trim(); if (!d) return; body = { description: d }; }
    setStatus(type === 'url' ? 'Fetching article...' : 'Adding story...');
    const data = await api('POST', `/editorial/${currentCorrelationId}/manual-story`, body);
    candidates = data.candidates; renderPhase1();
    setStatus('Manual story added');
  } catch (err) { showError('Failed: ' + err.message); }
}

async function confirmSelections() {
  if (!selections.leadStory) return showError('Select at least one Lead Story');
  if (selections.quickHits.length === 0) return showError('Select at least one Quick Hit');

  // Apply headline overrides to selections
  const applyOverride = (c) => {
    const override = headlineOverrides[c.id] || document.getElementById(`headline-${c.id}`)?.value;
    if (override && override !== c.headline) return { ...c, headline: override };
    return c;
  };
  const finalSelections = {
    leadStory: applyOverride(selections.leadStory),
    quickHits: selections.quickHits.map(applyOverride),
    watchListItems: selections.watchListItems.map(applyOverride),
  };

  const btn = document.getElementById('confirm-btn');
  btn.disabled = true; btn.textContent = 'Writing stories...';
  setStatus('Writing stories...');
  try {
    await api('POST', `/editorial/${currentCorrelationId}/select`, { selections: finalSelections });
    await pollUntilReady();
    await loadSections();
    hide('phase1-screen'); show('phase2-screen');
  } catch (err) {
    showError(err.message); btn.disabled = false; btn.textContent = 'Confirm Selections → Write Stories';
  }
}

// === PHASE 2: STORY EDITING ===
async function loadSections() {
  const data = await api('GET', `/editorial/${currentCorrelationId}/sections`);
  writtenSections = data.sections;
  renderPhase2();
}

function renderPhase2() {
  const container = document.getElementById('phase2-screen');
  setStatus('Phase 2 — Edit Stories');

  const lead = writtenSections.filter(s => s.role === 'lead_story');
  const qh = writtenSections.filter(s => s.role === 'quick_hit');
  const wl = writtenSections.filter(s => s.role === 'watch_list');

  let html = `
    <div class="phase-bar">
      <div class="phase-step done">1. Select Stories</div>
      <div class="phase-step active">2. Edit Stories</div>
      <div class="phase-step">3. Newsletter</div>
    </div>
    <h2 style="margin-bottom:16px;">Phase 2: Story Editing</h2>
    <p style="margin-bottom:16px;color:#666;">Review and edit each story. Change headlines, edit text, or regenerate any story you're not happy with.</p>`;

  // Lead story
  if (lead.length > 0) {
    html += `<h3 style="margin:20px 0 8px;color:#2e7d32;">Lead Story</h3>`;
    html += lead.map(s => sectionEditor(s)).join('');
  }

  // Quick hits
  if (qh.length > 0) {
    html += `<h3 style="margin:20px 0 8px;color:#1565c0;">Quick Hits</h3>`;
    html += qh.map(s => sectionEditor(s)).join('');
  }

  // Watch list
  if (wl.length > 0) {
    html += `<h3 style="margin:20px 0 8px;color:#e65100;">Watch List</h3>`;
    html += wl.map(s => sectionEditor(s)).join('');
  }

  html += `
    <div style="margin-top:24px;display:flex;gap:12px;">
      <button class="btn btn-primary" onclick="saveEditsAndContinue()">Save & Continue → Newsletter</button>
      <button class="btn btn-secondary" onclick="backToPhase1()">← Back to Selection</button>
    </div>`;

  container.innerHTML = html;
}

function sectionEditor(s) {
  const wc = countWords(s.plainTextContent || s.htmlContent);
  return `
    <div class="story-editor" id="editor-${s.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span class="badge ${badgeClass(s.role)}">${roleLabel(s.role)}</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="regenerateSection('${s.id}')">Regenerate</button>
        </div>
      </div>
      <input type="text" id="edit-headline-${s.id}" value="${esc(s.headline)}" style="margin-bottom:8px;" />
      <textarea id="edit-content-${s.id}" rows="${s.role==='lead_story'?10:5}">${esc(s.htmlContent)}</textarea>
      <div class="word-count" id="wc-${s.id}">${wc} words</div>
    </div>`;
}

async function regenerateSection(sectionId) {
  const section = writtenSections.find(s => s.id === sectionId);
  if (!section) return;
  // Show loading state on the button
  const editor = document.getElementById(`editor-${sectionId}`);
  const btn = editor?.querySelector('button');
  const originalText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Regenerating...'; btn.style.opacity = '0.6'; }
  try {
    setStatus('Regenerating section...');
    const data = await api('POST', `/editorial/${currentCorrelationId}/regenerate-section`, { sectionId });
    const idx = writtenSections.findIndex(s => s.id === sectionId);
    if (idx >= 0 && data.section) {
      writtenSections[idx] = { ...writtenSections[idx], headline: data.section.headline, htmlContent: data.section.htmlContent, plainTextContent: data.section.plainTextContent, wordCount: data.section.wordCount };
    }
    renderPhase2();
    setStatus('Section regenerated');
  } catch (err) {
    showError('Regenerate failed: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = originalText; btn.style.opacity = '1'; }
  }
}

async function saveEditsAndContinue() {
  setStatus('Saving edits...');
  // Save any edited headlines/content to the backend
  for (const s of writtenSections) {
    const headlineEl = document.getElementById(`edit-headline-${s.id}`);
    const contentEl = document.getElementById(`edit-content-${s.id}`);
    if (!headlineEl || !contentEl) continue;
    const newHeadline = headlineEl.value;
    const newContent = contentEl.value;
    if (newHeadline !== s.headline || newContent !== s.htmlContent) {
      try {
        await api('POST', `/editorial/${currentCorrelationId}/edit-section`, {
          sectionId: s.id, headline: newHeadline, htmlContent: newContent, plainTextContent: newContent.replace(/<[^>]*>/g, ''),
        });
        s.headline = newHeadline;
        s.htmlContent = newContent;
      } catch (err) { showError('Failed to save section: ' + err.message); return; }
    }
  }
  // Re-assemble newsletter with current theme
  try {
    setStatus('Assembling newsletter...');
    const data = await api('POST', `/editorial/${currentCorrelationId}/reassemble`, { theme: currentTheme });
    hide('phase2-screen'); show('phase3-screen');
    await loadDraftForPhase3();
  } catch (err) { showError('Assembly failed: ' + err.message); }
}

function backToPhase1() {
  hide('phase2-screen'); show('phase1-screen');
  setStatus('Phase 1 — Selection');
}

// === PHASE 3: NEWSLETTER EDITING ===
async function loadDraftForPhase3() {
  const data = await api('GET', `/editorial/${currentCorrelationId}/draft`);
  renderPhase3(data);
}

function renderPhase3(draft) {
  const container = document.getElementById('phase3-screen');
  setStatus('Phase 3 — Newsletter');

  const costHtml = draft.costSummary ? `
    <div class="cost-bar" style="margin-bottom:16px;">
      <div class="item"><span class="label">Search</span><span class="value">$${draft.costSummary.searchCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">Research</span><span class="value">$${draft.costSummary.researchCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">Writing</span><span class="value">$${draft.costSummary.writingCost.toFixed(4)}</span></div>
      <div class="item"><span class="label">Total</span><span class="value ${draft.costSummary.isOverBudget?'over-budget':''}">$${draft.costSummary.totalCost.toFixed(4)}</span></div>
    </div>` : '';

  // Subject line options
  const options = draft.subjectLineOptions || [];
  let subjectHtml = '<div class="subject-options">';
  for (const opt of options) {
    const sel = opt === draft.selectedSubjectLine ? 'selected' : '';
    subjectHtml += `<label class="subject-option ${sel}" onclick="selectSubjectLine(this,'${opt.replace(/'/g,"\\'")}')"><input type="radio" name="subject" ${sel?'checked':''} /> ${opt}</label>`;
  }
  subjectHtml += `<div class="input-group" style="margin-top:4px;"><input type="text" id="custom-subject" placeholder="Or write a custom subject line..." /></div></div>`;

  // Theme picker
  let themeHtml = '<div class="theme-grid">';
  for (const [name, theme] of Object.entries(presetThemes)) {
    const label = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const isSelected = currentTheme && currentTheme.headerColor === theme.headerColor && currentTheme.accentColor === theme.accentColor;
    themeHtml += `
      <div class="theme-swatch ${isSelected?'selected':''}" onclick="applyTheme('${name}')">
        <div class="preview" style="background:linear-gradient(135deg, ${theme.headerColor} 50%, ${theme.accentColor} 50%);"></div>
        <div>${label}</div>
      </div>`;
  }
  themeHtml += '</div>';
  themeHtml += `
    <div class="color-row">
      <label>Header <input type="color" id="tc-header" value="${currentTheme?.headerColor||'#0f3460'}" onchange="updateCustomColor()"></label>
      <label>Accent <input type="color" id="tc-accent" value="${currentTheme?.accentColor||'#0f3460'}" onchange="updateCustomColor()"></label>
      <label>Background <input type="color" id="tc-bg" value="${currentTheme?.backgroundColor||'#f4f4f8'}" onchange="updateCustomColor()"></label>
      <label>Footer <input type="color" id="tc-footer" value="${currentTheme?.footerColor||'#1a1a2e'}" onchange="updateCustomColor()"></label>
    </div>`;

  let html = `
    <div class="phase-bar">
      <div class="phase-step done">1. Select Stories</div>
      <div class="phase-step done">2. Edit Stories</div>
      <div class="phase-step active">3. Newsletter</div>
    </div>
    <h2 style="margin-bottom:16px;">Phase 3: Newsletter Editing</h2>
    ${costHtml}
    <div class="card"><h3>Subject Line</h3>${subjectHtml}</div>
    <div class="card" style="margin-top:16px;"><h3>Theme & Style</h3>${themeHtml}</div>
    <div class="card" style="margin-top:16px;">
      <h3>Newsletter Preview</h3>
      <div class="preview-toggle">
        <button class="btn btn-secondary" onclick="setPreviewMode('desktop')">Desktop</button>
        <button class="btn btn-secondary" onclick="setPreviewMode('mobile')">Mobile</button>
      </div>
      <div class="preview-frame">
        <iframe id="preview-iframe" style="width:100%;height:700px;border:none;"></iframe>
      </div>
    </div>
    <div style="margin-top:20px;display:flex;gap:12px;">
      <button class="btn btn-success" onclick="approveNewsletter()">Approve & Send</button>
      <button class="btn btn-danger" onclick="rejectNewsletter()">Reject</button>
      <button class="btn btn-secondary" onclick="backToPhase2()">← Back to Story Editing</button>
    </div>`;

  container.innerHTML = html;

  // Load preview
  const iframe = document.getElementById('preview-iframe');
  if (iframe && draft.html) {
    iframe.srcdoc = draft.html.replace('<head>', '<head><base target="_blank">');
  }
}

function selectSubjectLine(el, line) {
  document.querySelectorAll('.subject-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  el.querySelector('input').checked = true;
}

function setPreviewMode(mode) {
  document.getElementById('preview-iframe').style.width = mode === 'mobile' ? '375px' : '100%';
}

async function applyTheme(name) {
  const theme = presetThemes[name];
  if (!theme) return;
  currentTheme = { ...theme };
  // Update color pickers
  document.getElementById('tc-header').value = theme.headerColor;
  document.getElementById('tc-accent').value = theme.accentColor;
  document.getElementById('tc-bg').value = theme.backgroundColor;
  document.getElementById('tc-footer').value = theme.footerColor;
  // Update swatch selection
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  // Re-assemble with new theme
  await reassembleWithTheme();
}

async function updateCustomColor() {
  currentTheme = {
    ...currentTheme,
    headerColor: document.getElementById('tc-header').value,
    accentColor: document.getElementById('tc-accent').value,
    backgroundColor: document.getElementById('tc-bg').value,
    footerColor: document.getElementById('tc-footer').value,
  };
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('selected'));
  await reassembleWithTheme();
}

async function reassembleWithTheme() {
  try {
    setStatus('Applying theme...');
    const data = await api('POST', `/editorial/${currentCorrelationId}/reassemble`, { theme: currentTheme });
    const iframe = document.getElementById('preview-iframe');
    if (iframe && data.html) {
      iframe.srcdoc = data.html.replace('<head>', '<head><base target="_blank">');
    }
    setStatus('Phase 3 — Newsletter');
  } catch (err) { showError('Theme failed: ' + err.message); }
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
  } catch (err) { showError(err.message); }
}

async function rejectNewsletter() {
  const feedback = prompt('Rejection feedback (optional):');
  try {
    await api('POST', `/editorial/${currentCorrelationId}/reject`, { feedback, returnToPhase1: false });
    setStatus('Rejected');
    alert('Newsletter rejected.');
  } catch (err) { showError(err.message); }
}

function backToPhase2() {
  hide('phase3-screen'); show('phase2-screen');
  setStatus('Phase 2 — Edit Stories');
}
