/**
 * TextWeb Job Pipeline Dashboard
 * 
 * Manages job tracking state and pushes live updates to OpenClaw Canvas.
 * Uses a local JSON file for persistence and canvas.eval for real-time UI.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const STATE_FILE = path.join(process.env.HOME, '.jobsearch', 'pipeline-state.json');

// ── State Management ──────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { jobs: [], stats: { totalApplied: 0, sessions: [] }, lastUpdated: null };
  }
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function addJob(job) {
  const state = loadState();
  // Dedup by company+title
  const existing = state.jobs.findIndex(j => j.company === job.company && j.title === job.title);
  if (existing >= 0) {
    state.jobs[existing] = { ...state.jobs[existing], ...job };
  } else {
    state.jobs.push(job);
  }
  saveState(state);
  return state;
}

function updateJobStatus(company, title, status, extra = {}) {
  const state = loadState();
  const job = state.jobs.find(j => j.company === company && j.title === title);
  if (job) {
    job.status = status;
    Object.assign(job, extra);
    saveState(state);
  }
  return state;
}

function getStats(state) {
  state = state || loadState();
  const confirmed = state.jobs.filter(j => j.status === 'submitted').length;
  const probable = state.jobs.filter(j => j.status === 'probable').length;
  const failed = state.jobs.filter(j => j.status === 'failed').length;
  const active = state.jobs.filter(j => j.status === 'active').length;
  const total = state.jobs.length;
  return { confirmed, probable, failed, active, total };
}

// ── Canvas Push ───────────────────────────────────────────────

// Canvas session dir — OpenClaw uses agent_main_main for main session
function getCanvasDir() {
  const base = path.join(process.env.HOME, 'Library', 'Application Support', 'OpenClaw', 'canvas');
  // Try agent_main_main first, fall back to main
  const agent = path.join(base, 'agent_main_main');
  if (fs.existsSync(agent)) return agent;
  const main = path.join(base, 'main');
  fs.mkdirSync(main, { recursive: true });
  return main;
}

// Write dashboard HTML with embedded state data
function pushCanvasState(state, liveStatus) {
  const canvasDir = getCanvasDir();
  const payload = {
    ...state,
    liveStatus: liveStatus || null,
    pushedAt: new Date().toISOString(),
  };
  
  // Read template and inject state
  const templatePath = path.join(__dirname, '..', 'canvas', 'dashboard.html');
  let html;
  if (fs.existsSync(templatePath)) {
    html = fs.readFileSync(templatePath, 'utf8');
  } else {
    html = getDashboardHTML();
  }
  
  // Inject state as embedded JSON
  const stateScript = `<script>window.__PIPELINE_STATE__ = ${JSON.stringify(payload)};</script>`;
  html = html.replace('</head>', stateScript + '\n</head>');
  
  fs.writeFileSync(path.join(canvasDir, 'dashboard.html'), html);
}

// Push state to canvas by writing HTML with embedded state
function pushFullDashboard(state) {
  state = state || loadState();
  pushCanvasState(state);
}

function pushStatusUpdate(company, title, status, detail) {
  const state = loadState();
  pushCanvasState(state, detail);
}

function getDashboardHTML() {
  // Inline fallback if template not found
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pipeline</title></head><body style="background:#0a0a1a;color:#eee;font-family:system-ui;padding:20px"><h1>TextWeb Pipeline</h1><div id="data"></div><script>const s=window.__PIPELINE_STATE__||{jobs:[]};document.getElementById("data").textContent=JSON.stringify(s,null,2);<\/script></body></html>';
}

// ── Event Emitter for Pipeline Integration ────────────────────

class PipelineDashboard {
  constructor() {
    this.state = loadState();
  }
  
  async init() {
    await pushFullDashboard(this.state);
  }
  
  async queueJob(job) {
    this.state = addJob({
      ...job,
      status: 'queued',
      queuedAt: new Date().toISOString(),
    });
    await pushFullDashboard(this.state);
  }
  
  async startJob(company, title) {
    this.state = updateJobStatus(company, title, 'active', { startedAt: new Date().toISOString() });
    await pushFullDashboard(this.state);
  }
  
  async fieldFilling(company, title, fieldName, value) {
    await pushStatusUpdate(company, title, 'filling', `${company}: ✏️ ${fieldName} → ${value.substring(0, 30)}`);
  }
  
  async llmGenerating(company, title, count) {
    await pushStatusUpdate(company, title, 'llm', `${company}: 🤖 Generating ${count} answers...`);
  }
  
  async uploading(company, title) {
    await pushStatusUpdate(company, title, 'uploading', `${company}: 📎 Uploading resume...`);
  }
  
  async submitting(company, title) {
    await pushStatusUpdate(company, title, 'submitting', `${company}: 🔘 Submitting...`);
  }
  
  async submitted(company, title, details = {}) {
    this.state = updateJobStatus(company, title, 'submitted', {
      submittedAt: new Date().toISOString(),
      ...details,
    });
    await pushFullDashboard(this.state);
  }
  
  async probable(company, title, details = {}) {
    this.state = updateJobStatus(company, title, 'probable', {
      submittedAt: new Date().toISOString(),
      ...details,
    });
    await pushFullDashboard(this.state);
  }
  
  async failed(company, title, reason) {
    this.state = updateJobStatus(company, title, 'failed', {
      failedAt: new Date().toISOString(),
      failReason: reason,
    });
    await pushFullDashboard(this.state);
  }
  
  getState() { return loadState(); }
  getStats() { return getStats(loadState()); }
}

module.exports = {
  PipelineDashboard,
  loadState,
  saveState,
  addJob,
  updateJobStatus,
  getStats,
  pushFullDashboard,
  pushStatusUpdate,
};
