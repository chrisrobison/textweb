#!/usr/bin/env node

/**
 * TextWeb Job Application Agent
 * 
 * Fills out job applications using text-grid rendering instead of screenshots.
 * Handles: LinkedIn Easy Apply, Greenhouse, Workday, Lever, Ashby, generic forms.
 * 
 * Usage:
 *   node apply.js <url> [--resume path] [--cover-letter path] [--dry-run]
 *   node apply.js --batch <jobs.json>
 */

const { AgentBrowser } = require('./browser');
const path = require('path');
const fs = require('fs');

// ─── Applicant Profile ───────────────────────────────────────────────────────

const PROFILE = {
  firstName: 'Christopher',
  lastName: 'Robison',
  fullName: 'Christopher Robison',
  email: 'cdr@cdr2.com',
  phone: '(415) 810-6991',
  location: 'San Francisco, CA',
  linkedin: 'https://linkedin.com/in/crobison',
  github: 'https://github.com/chrisrobison',
  website: 'https://cdr2.com',
  currentTitle: 'CTO',
  currentCompany: 'D. Harris Tours',
  yearsExperience: '25',
  willingToRelocate: 'Yes',
  workAuthorization: 'US Citizen',
  requireSponsorship: 'No',
  salaryExpectation: '200000',
  noticePeriod: 'Immediately',
  
  // Default resume/cover letter
  resumePath: path.join(process.env.HOME, '.jobsearch/christopher-robison-resume.pdf'),
  coverLetterPath: null, // set per-application if available
};

// ─── Field Matching ──────────────────────────────────────────────────────────
// Maps common form field labels/placeholders to profile values

const FIELD_PATTERNS = [
  // Name fields
  { match: /first\s*name/i, value: () => PROFILE.firstName },
  { match: /last\s*name|family\s*name|surname/i, value: () => PROFILE.lastName },
  { match: /full\s*name|^name$|^name:|customer.*name|your.*name|applicant.*name/i, value: () => PROFILE.fullName },
  
  // Contact (email before address — "email address" should match email, not location)
  { match: /e-?mail/i, value: () => PROFILE.email },
  { match: /phone|mobile|cell|telephone/i, value: () => PROFILE.phone },
  
  // Location (exclude "email address" and yes/no questions that mention "location")
  { match: /^(?!.*e-?mail)(?!.*authorized)(?!.*sponsor)(?!.*remote)(?!.*relocat).*(city|^location$|address|zip|postal)/i, value: () => PROFILE.location },
  
  // Links
  { match: /linkedin/i, value: () => PROFILE.linkedin },
  { match: /github/i, value: () => PROFILE.github },
  { match: /website|portfolio|personal.*url|blog/i, value: () => PROFILE.website },
  
  // Work info
  { match: /current.*title|job.*title/i, value: () => PROFILE.currentTitle },
  { match: /current.*company|employer|organization/i, value: () => PROFILE.currentCompany },
  { match: /^(?!.*do you have).*(?:years.*experience|experience.*years|how many years)/i, value: () => PROFILE.yearsExperience },
  { match: /^do you have.*(?:years|experience)/i, value: () => 'Yes' },
  
  // Logistics
  { match: /relocat/i, value: () => PROFILE.willingToRelocate },
  { match: /authorized|authorization|legally.*work|eligible.*work/i, value: () => 'Yes' },
  { match: /sponsor/i, value: () => 'No' },
  { match: /plan to work remote|prefer.*remote|work.*remotely/i, value: () => 'Yes' },
  { match: /ever been employed|previously.*employed|worked.*before/i, value: () => 'No' },
  { match: /salary|compensation|pay.*expect/i, value: () => PROFILE.salaryExpectation },
  { match: /notice.*period|start.*date|availab.*start|when.*start/i, value: () => PROFILE.noticePeriod },
  { match: /how.*hear|where.*find|referr(?!ed)|source.*(?:job|opening|position)|how.*learn.*about/i, value: () => 'Online job search' },
];

// ─── Platform Detection ─────────────────────────────────────────────────────

function detectPlatform(url, pageText) {
  const u = url.toLowerCase();
  const t = (pageText || '').toLowerCase();
  
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('greenhouse.io') || u.includes('boards.greenhouse')) return 'greenhouse';
  if (u.includes('myworkday') || u.includes('workday.com')) return 'workday';
  if (u.includes('lever.co') || u.includes('jobs.lever')) return 'lever';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('smartrecruiters')) return 'smartrecruiters';
  if (u.includes('icims')) return 'icims';
  if (u.includes('indeed.com')) return 'indeed';
  if (t.includes('greenhouse')) return 'greenhouse';
  if (t.includes('workday')) return 'workday';
  if (t.includes('lever')) return 'lever';
  return 'generic';
}

// ─── Form Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze a page snapshot to identify fillable fields and map them to profile data
 */
function analyzeForm(result) {
  const { view, elements } = result;
  const lines = view.split('\n');
  const actions = [];
  
  for (const [ref, el] of Object.entries(elements)) {
    if (el.semantic === 'input' || el.semantic === 'textarea') {
      // Use the label from the renderer (which checks <label for>, aria-label, etc.)
      // Fall back to spatial label detection from the text grid
      const label = el.label || findLabel(el, lines, result);
      const profileValue = matchFieldToProfile(label, el);
      
      if (profileValue) {
        actions.push({
          action: 'type',
          ref: parseInt(ref),
          value: profileValue,
          field: label,
          confidence: 'high',
        });
      } else {
        actions.push({
          action: 'type',
          ref: parseInt(ref),
          value: null,
          field: label,
          confidence: 'unknown',
        });
      }
    }
    
    if (el.semantic === 'file') {
      const label = el.label || findLabel(el, lines, result);
      const isResume = /resume|cv/i.test(label);
      const isCoverLetter = /cover.*letter/i.test(label);
      
      actions.push({
        action: 'upload',
        ref: parseInt(ref),
        filePath: isCoverLetter ? PROFILE.coverLetterPath : PROFILE.resumePath,
        field: label,
        fileType: isCoverLetter ? 'cover_letter' : 'resume',
      });
    }
    
    if (el.semantic === 'select') {
      const label = el.label || findLabel(el, lines, result);
      actions.push({
        action: 'select',
        ref: parseInt(ref),
        field: label,
        confidence: 'needs_review',
      });
    }

    if (el.semantic === 'checkbox' || el.semantic === 'radio') {
      const label = el.label || findLabel(el, lines, result);
      // Auto-check common consent/agreement checkboxes
      if (/agree|consent|acknowledge|confirm|certif/i.test(label)) {
        actions.push({
          action: 'click',
          ref: parseInt(ref),
          field: label,
          reason: 'auto-agree',
        });
      }
    }
  }
  
  // Find submit button
  for (const [ref, el] of Object.entries(elements)) {
    if (el.semantic === 'button' || el.semantic === 'link') {
      const text = (el.text || '').toLowerCase();
      if (/submit|apply|next|continue|save|send/i.test(text) && !/cancel|back|sign.*in|log.*in/i.test(text)) {
        actions.push({
          action: 'submit',
          ref: parseInt(ref),
          text: el.text,
        });
      }
    }
  }
  
  return actions;
}

/**
 * Find the label text associated with a form field
 */
function findLabel(el, lines, result) {
  // Strategy 1: Check the element's own text/placeholder
  if (el.text && el.text.length > 2) return el.text;
  
  // Strategy 2: Look at the text grid near this element's position
  // Find which line this element is on
  const view = result.view;
  const allLines = view.split('\n');
  
  for (let i = 0; i < allLines.length; i++) {
    const refPattern = `[${Object.entries(result.elements).find(([r, e]) => e === el)?.[0]}`;
    if (allLines[i].includes(refPattern)) {
      // Check same line for label text (to the left of the field)
      const line = allLines[i];
      const refIdx = line.indexOf(refPattern);
      const leftText = line.substring(0, refIdx).trim();
      if (leftText) return leftText;
      
      // Check line above
      if (i > 0) {
        const above = allLines[i - 1].trim();
        if (above && above.length < 60) return above;
      }
      break;
    }
  }
  
  return el.text || 'unknown field';
}

/**
 * Match a field label to profile data
 */
function matchFieldToProfile(label, el) {
  if (!label) return null;
  
  for (const pattern of FIELD_PATTERNS) {
    if (pattern.match.test(label)) {
      return pattern.value();
    }
  }
  
  return null;
}

// ─── Application Engine ─────────────────────────────────────────────────────

class JobApplicator {
  constructor(options = {}) {
    this.browser = null;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.resumePath = options.resumePath || PROFILE.resumePath;
    this.coverLetterPath = options.coverLetterPath || PROFILE.coverLetterPath;
    this.maxSteps = options.maxSteps || 10; // safety limit for multi-step forms
    this.log = [];
  }

  async init() {
    this.browser = new AgentBrowser({ cols: 120 });
    await this.browser.launch();
    return this;
  }

  async apply(url) {
    this._log('info', `Starting application: ${url}`);
    
    // Navigate to the application page
    let result = await this.browser.navigate(url);
    const platform = detectPlatform(url, result.view);
    this._log('info', `Detected platform: ${platform}`);
    this._log('info', `Page: ${result.meta.title}`);
    
    if (this.verbose) {
      console.log('\n' + result.view + '\n');
    }

    let step = 0;
    let completed = false;

    while (step < this.maxSteps && !completed) {
      step++;
      this._log('info', `--- Step ${step} ---`);
      
      // Analyze current form
      const actions = analyzeForm(result);
      
      if (actions.length === 0) {
        this._log('warn', 'No form fields or actions found on this page');
        break;
      }

      // Report what we found
      const fillable = actions.filter(a => a.action === 'type' && a.value);
      const unknown = actions.filter(a => a.action === 'type' && !a.value);
      const uploads = actions.filter(a => a.action === 'upload');
      const submits = actions.filter(a => a.action === 'submit');
      
      this._log('info', `Found: ${fillable.length} auto-fill, ${unknown.length} unknown, ${uploads.length} uploads, ${submits.length} buttons`);

      // Fill in known fields
      for (const action of fillable) {
        this._log('fill', `[${action.ref}] ${action.field} → "${action.value}"`);
        if (!this.dryRun) {
          try {
            result = await this.browser.type(action.ref, action.value);
          } catch (err) {
            this._log('error', `Failed to fill [${action.ref}] ${action.field}: ${err.message}`);
          }
        }
      }

      // Upload files
      for (const action of uploads) {
        const filePath = action.fileType === 'cover_letter' 
          ? (this.coverLetterPath || this.resumePath)
          : this.resumePath;
          
        if (filePath && fs.existsSync(filePath)) {
          this._log('upload', `[${action.ref}] ${action.field} ← ${path.basename(filePath)}`);
          if (!this.dryRun) {
            try {
              result = await this.browser.upload(action.ref, filePath);
            } catch (err) {
              this._log('error', `Failed to upload [${action.ref}]: ${err.message}`);
            }
          }
        } else {
          this._log('warn', `No file for ${action.field} (path: ${filePath})`);
        }
      }

      // Click agreement checkboxes
      for (const action of actions.filter(a => a.action === 'click')) {
        this._log('click', `[${action.ref}] ${action.field} (${action.reason})`);
        if (!this.dryRun) {
          try {
            result = await this.browser.click(action.ref);
          } catch (err) {
            this._log('error', `Failed to click [${action.ref}]: ${err.message}`);
          }
        }
      }

      // Log unknown fields
      for (const action of unknown) {
        this._log('skip', `[${action.ref}] "${action.field}" — no auto-fill match`);
      }

      // Take a fresh snapshot after fills
      if (!this.dryRun) {
        result = await this.browser.snapshot();
      }

      if (this.verbose) {
        console.log('\n--- After filling ---');
        console.log(result.view);
      }

      // Find submit/next button
      const submitBtn = submits.find(s => /next|continue/i.test(s.text)) || submits[0];
      
      if (!submitBtn) {
        this._log('warn', 'No submit/next button found');
        break;
      }

      // Check for confirmation/success indicators
      const viewLower = result.view.toLowerCase();
      if (/application.*submitted|thank.*you.*appl|success.*submitted|application.*received/i.test(viewLower)) {
        this._log('success', '🎉 Application submitted successfully!');
        completed = true;
        break;
      }

      // Submit / go to next step
      this._log('click', `[${submitBtn.ref}] "${submitBtn.text}"`);
      if (!this.dryRun) {
        const prevUrl = result.meta.url;
        try {
          result = await this.browser.click(submitBtn.ref);
        } catch (err) {
          this._log('error', `Submit click failed: ${err.message}`);
          break;
        }

        // Check if we landed on a success/thank you page
        const newView = result.view.toLowerCase();
        if (/application.*submitted|thank.*you|success|received.*application|already.*applied/i.test(newView)) {
          this._log('success', '🎉 Application submitted successfully!');
          completed = true;
          break;
        }
        
        // Check if URL changed significantly (redirect to confirmation)
        if (result.meta.url !== prevUrl && /confirm|success|thank/i.test(result.meta.url)) {
          this._log('success', '🎉 Redirected to confirmation page');
          completed = true;
          break;
        }
      } else {
        this._log('dry-run', `Would click [${submitBtn.ref}] "${submitBtn.text}"`);
        break;
      }
    }

    if (step >= this.maxSteps) {
      this._log('warn', `Reached max steps (${this.maxSteps}). May need manual review.`);
    }

    return {
      url,
      platform,
      completed,
      steps: step,
      log: this.log,
      finalView: result.view,
    };
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  _log(level, message) {
    const entry = { time: new Date().toISOString(), level, message };
    this.log.push(entry);
    const prefix = {
      info: '  ℹ',
      fill: '  ✏️',
      upload: '  📎',
      click: '  👆',
      skip: '  ⏭️',
      warn: '  ⚠️',
      error: '  ❌',
      success: '  ✅',
      'dry-run': '  🔍',
    }[level] || '  ';
    console.error(`${prefix} ${message}`);
  }
}

// ─── Batch Mode ─────────────────────────────────────────────────────────────

async function batchApply(jobsFile, options) {
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const results = [];
  
  console.error(`\nBatch applying to ${jobs.length} jobs...\n`);
  
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const url = job.apply_url || job.url || job.applyUrl;
    if (!url) {
      console.error(`  ⏭️  [${i + 1}/${jobs.length}] Skipping "${job.title}" — no URL`);
      continue;
    }
    
    console.error(`\n━━━ [${i + 1}/${jobs.length}] ${job.title || 'Unknown'} at ${job.company || 'Unknown'} ━━━`);
    
    const applicator = new JobApplicator({
      ...options,
      coverLetterPath: job.coverLetterPath || options.coverLetterPath,
      resumePath: job.resumePath || options.resumePath,
    });
    
    try {
      await applicator.init();
      const result = await applicator.apply(url);
      results.push({ job, ...result });
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      results.push({ job, url, completed: false, error: err.message });
    } finally {
      await applicator.close();
    }
    
    // Brief pause between applications
    if (i < jobs.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Summary
  const succeeded = results.filter(r => r.completed).length;
  const failed = results.filter(r => !r.completed).length;
  console.error(`\n━━━ Summary: ${succeeded} submitted, ${failed} need review ━━━\n`);
  
  // Output results as JSON to stdout
  console.log(JSON.stringify(results, null, 2));
  return results;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  
  const options = {
    dryRun: false,
    verbose: false,
    resumePath: PROFILE.resumePath,
    coverLetterPath: null,
    batchFile: null,
    url: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') options.verbose = true;
    else if (arg === '--resume') options.resumePath = args[++i];
    else if (arg === '--cover-letter') options.coverLetterPath = args[++i];
    else if (arg === '--batch') options.batchFile = args[++i];
    else if (arg === '-h' || arg === '--help') { printHelp(); process.exit(0); }
    else if (!arg.startsWith('-')) options.url = arg;
  }

  if (options.batchFile) {
    await batchApply(options.batchFile, options);
    return;
  }

  if (!options.url) {
    printHelp();
    process.exit(1);
  }

  const applicator = new JobApplicator(options);
  try {
    await applicator.init();
    const result = await applicator.apply(options.url);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await applicator.close();
  }
}

function printHelp() {
  console.log(`
TextWeb Job Applicator — Fill out job applications without screenshots

Usage:
  node apply.js <url>                     Apply to a single job
  node apply.js --batch <jobs.json>       Apply to multiple jobs
  
Options:
  --dry-run, -n         Show what would be filled without submitting
  --verbose, -v         Print page views at each step
  --resume <path>       Path to resume PDF (default: ~/.jobsearch/christopher-robison-resume.pdf)
  --cover-letter <path> Path to cover letter PDF
  -h, --help            Show this help

Batch JSON format:
  [
    { "title": "VP Eng", "company": "Acme", "apply_url": "https://..." },
    { "title": "CTO", "company": "Startup", "url": "https://...", "resumePath": "/custom/resume.pdf" }
  ]

Examples:
  node apply.js https://boards.greenhouse.io/company/jobs/123
  node apply.js --dry-run https://jobs.lever.co/company/abc-123
  node apply.js --batch ~/.jobsearch/to_apply.json --verbose
`);
}

module.exports = { JobApplicator, analyzeForm, detectPlatform, PROFILE, FIELD_PATTERNS };

if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
