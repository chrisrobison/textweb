#!/usr/bin/env node
/**
 * TextWeb Job Pipeline — Full auto-apply with Canvas dashboard
 * 
 * Usage:
 *   node pipeline.js                     # Discover + apply
 *   node pipeline.js --discover-only     # Just find jobs, show on canvas
 *   node pipeline.js --jobs jobs.json    # Apply from a pre-built list
 *   node pipeline.js --url <url>         # Apply to a single URL
 *   node pipeline.js --company <name> --url <url>
 */

const { AgentBrowser } = require('./browser');
const { analyzeForm } = require('./apply');
const { generateAnswers, checkLLM } = require('./llm');
const { PipelineDashboard } = require('./dashboard');
const fs = require('fs');
const path = require('path');

const RESUME = path.join(process.env.HOME, '.jobsearch', 'christopher-robison-resume.pdf');

// ── Job Discovery ─────────────────────────────────────────────

const GREENHOUSE_BOARDS = [
  { name: 'Stripe', board: 'stripe' },
  { name: 'Discord', board: 'discord' },
  { name: 'Figma', board: 'figma' },
  { name: 'Vercel', board: 'vercel' },
  { name: 'Postman', board: 'postman' },
  { name: 'Airtable', board: 'airtable' },
  { name: 'GitLab', board: 'gitlab' },
  { name: 'Cloudflare', board: 'cloudflare' },
  { name: 'Coinbase', board: 'coinbase' },
  { name: 'Scale AI', board: 'scaleai' },
  { name: 'Rippling', board: 'rippling' },
  { name: 'Retool', board: 'retool' },
  { name: 'Supabase', board: 'supabase' },
  { name: 'Doximity', board: 'doximity' },
  { name: 'DoorDash', board: 'doordash' },
  { name: 'Instacart', board: 'instacart' },
  { name: 'HashiCorp', board: 'hashicorp' },
  { name: 'Plaid', board: 'plaid' },
  { name: 'Anduril', board: 'andurilindustries' },
  { name: 'Linear', board: 'linear06' },
  { name: 'Notion', board: 'notion' },
  { name: 'Anthropic', board: 'anthropic' },
  { name: 'OpenAI', board: 'openai' },
  { name: 'Databricks', board: 'databricks' },
  { name: 'Datadog', board: 'datadoghq' },
  { name: 'MongoDB', board: 'mongodb' },
  { name: 'Elastic', board: 'elastic' },
  { name: 'Snyk', board: 'snyk' },
  { name: 'Grafana', board: 'grafanalabs' },
  { name: 'Temporal', board: 'temporaltechnologies' },
];

const TITLE_PATTERNS = /director|manager|vp|head|staff|principal|lead|architect/i;
const DEPT_PATTERNS = /eng|software|platform|infra|tech|full.?stack|backend|frontend|mobile|data|ai|ml|devops|sre|cloud/i;

async function discoverJobs(browser, boards, existingUrls = new Set()) {
  const found = [];
  
  for (const c of boards) {
    try {
      await browser.navigate('https://boards.greenhouse.io/' + c.board);
      
      const jobs = await browser.page.evaluate(() => {
        const results = [];
        document.querySelectorAll('a').forEach(a => {
          const href = a.getAttribute('href') || '';
          const m = href.match(/\/jobs\/(\d+)/);
          if (m) results.push({ id: m[1], title: a.textContent.trim().substring(0, 120) });
        });
        return results;
      });
      
      const matches = jobs.filter(j =>
        TITLE_PATTERNS.test(j.title) && DEPT_PATTERNS.test(j.title)
      );
      
      for (const j of matches.slice(0, 3)) {
        const url = `https://job-boards.greenhouse.io/embed/job_app?for=${c.board}&token=${j.id}`;
        if (!existingUrls.has(url)) {
          found.push({
            company: c.name,
            title: j.title.replace(/\s+/g, ' ').trim(),
            url,
            board: c.board,
            jobId: j.id,
          });
        }
      }
    } catch (e) {
      // Board not found or errored — skip
    }
  }
  
  return found;
}

// ── Application Engine ────────────────────────────────────────

async function applyToJob(browser, job, llmOk, dash) {
  const { company, title, url } = job;
  
  await dash.startJob(company, title);
  
  let r;
  try {
    r = await browser.navigate(url);
  } catch (e) {
    await dash.failed(company, title, 'Page load failed');
    return false;
  }
  
  if (Object.keys(r.elements).length < 5) {
    await dash.failed(company, title, 'Too few elements (expired?)');
    return false;
  }
  
  const actions = analyzeForm(r);
  const fillable = actions.filter(a => a.action === 'type' && a.value && a.selector);
  const unknowns = actions.filter(a => a.action === 'type' && !a.value && a.selector);
  const uploads = actions.filter(a => a.action === 'upload' && a.selector);
  const skips = actions.filter(a => a.action === 'skip');
  
  console.log(`[${company}] Plan: ${fillable.length} auto | ${unknowns.length} LLM | ${uploads.length} upload | ${skips.length} skip`);
  
  // Phase 1: Auto-fill
  for (const a of fillable) {
    try {
      const isCombo = await browser.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el && (el.getAttribute('role') === 'combobox' || el.classList.contains('select__input'));
      }, a.selector);
      
      if (isCombo) {
        await browser.page.click(a.selector);
        await browser.page.fill(a.selector, '');
        await browser.page.type(a.selector, a.value, { delay: 50 });
        await browser.page.waitForTimeout(500);
        await browser.page.keyboard.press('ArrowDown');
        await browser.page.waitForTimeout(100);
        await browser.page.keyboard.press('Enter');
        await browser.page.waitForTimeout(200);
      } else {
        await browser.fillBySelector(a.selector, a.value);
      }
      
      await dash.fieldFilling(company, title, a.field, a.value);
      console.log(`  ✏️  ${a.field} → ${a.value}`);
    } catch (e) {
      console.log(`  ⚠️  ${a.field} FAIL: ${e.message.substring(0, 50)}`);
    }
  }
  
  // Phase 2: Upload
  for (const a of uploads) {
    try {
      await dash.uploading(company, title);
      await browser.uploadBySelector(a.selector, RESUME);
      console.log('  📎 Resume uploaded');
    } catch (e) {
      console.log('  ⚠️  Upload failed');
    }
  }
  
  // Phase 3: LLM
  if (unknowns.length > 0 && llmOk) {
    await dash.llmGenerating(company, title, unknowns.length);
    console.log(`  🤖 Generating ${unknowns.length} answers...`);
    
    const answers = await generateAnswers(unknowns, r.view.substring(0, 2000), company);
    for (const u of unknowns) {
      const ans = answers[u.ref];
      if (ans) {
        try {
          await browser.fillBySelector(u.selector, ans);
          await dash.fieldFilling(company, title, u.field, ans);
          console.log(`  🤖 ${u.field.substring(0, 50)} → ${ans.substring(0, 60)}...`);
        } catch (e) {
          console.log(`  ⚠️  ${u.field.substring(0, 50)} FAIL`);
        }
      }
    }
  }
  
  for (const a of skips) {
    console.log(`  ⏭️  ${a.field} (EEO)`);
  }
  
  // Phase 4: Submit
  await dash.submitting(company, title);
  r = await browser.snapshot();
  
  let submitSel = null;
  for (const [ref, el] of Object.entries(r.elements)) {
    if ((el.semantic === 'button' || el.semantic === 'link') && /submit/i.test(el.text || '')) {
      submitSel = el.selector;
      break;
    }
  }
  
  if (!submitSel) {
    await dash.failed(company, title, 'No submit button found');
    console.log('  ❌ No submit button');
    return false;
  }
  
  try {
    await browser.page.click(submitSel);
    await Promise.race([
      browser.page.waitForNavigation({ timeout: 8000 }).catch(() => {}),
      browser.page.waitForTimeout(6000),
    ]);
    r = await browser.snapshot();
    const t = r.view.toLowerCase();
    
    if (/error|required|invalid|please.*fill/i.test(t.substring(0, 600))) {
      await dash.failed(company, title, 'Validation errors');
      console.log('  ❌ Validation errors');
      return false;
    }
    
    const details = { autoFields: fillable.length, llmFields: unknowns.length };
    
    if (/submitted|thank\s*you|success|received|confirmed|we.*review/i.test(t)) {
      await dash.submitted(company, title, details);
      console.log('  ✅ SUBMITTED! 🎉');
      return true;
    } else {
      // No errors = probably worked
      await dash.submitted(company, title, details);
      console.log('  ✅ SUBMITTED (no errors)');
      return true;
    }
  } catch (e) {
    await dash.failed(company, title, e.message.substring(0, 60));
    console.log(`  ❌ ${e.message.substring(0, 60)}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const discoverOnly = args.includes('--discover-only');
  const jobsFile = args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : null;
  const singleUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
  const singleCompany = args.includes('--company') ? args[args.indexOf('--company') + 1] : 'Unknown';
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;
  
  const dash = new PipelineDashboard();
  await dash.init();
  
  const llmOk = await checkLLM();
  console.log('LLM:', llmOk ? '✅' : '❌');
  
  const browser = new AgentBrowser({ cols: 120 });
  await browser.launch();
  
  let jobs = [];
  
  if (singleUrl) {
    jobs = [{ company: singleCompany, title: 'Application', url: singleUrl }];
  } else if (jobsFile) {
    jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  } else {
    // Discover new jobs
    console.log('🔍 Discovering jobs from', GREENHOUSE_BOARDS.length, 'boards...');
    const state = dash.getState();
    const existingUrls = new Set(state.jobs.map(j => j.url));
    
    jobs = await discoverJobs(browser, GREENHOUSE_BOARDS, existingUrls);
    console.log(`Found ${jobs.length} new matching roles`);
    
    // Queue them all on the dashboard
    for (const job of jobs.slice(0, limit)) {
      await dash.queueJob(job);
    }
    
    if (discoverOnly) {
      console.log('Discovery only — not applying.');
      await browser.close();
      return;
    }
    
    jobs = jobs.slice(0, limit);
  }
  
  // Apply to each
  const results = [];
  for (const job of jobs) {
    const ok = await applyToJob(browser, job, llmOk, dash);
    results.push({ ...job, ok });
  }
  
  await browser.close();
  
  // Final summary
  console.log('\n═══ SUMMARY ═══');
  const submitted = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.company} — ${r.title}`);
  }
  console.log(`\n${submitted} submitted, ${failed} failed out of ${results.length} total`);
  
  // Refresh dashboard
  await dash.init();
}

main().catch(e => {
  console.error('Pipeline error:', e);
  process.exit(1);
});
