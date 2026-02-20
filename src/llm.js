/**
 * TextWeb LLM Integration
 * 
 * Generates answers for freeform job application questions using
 * a local LLM (LM Studio) or remote API (OpenAI-compatible).
 * 
 * Configuration (in order of priority):
 *   1. Config object passed to functions
 *   2. Environment variables (TEXTWEB_LLM_URL, TEXTWEB_LLM_API_KEY, etc.)
 *   3. .env file in project root or cwd
 *   4. Defaults (LM Studio at localhost:1234)
 * 
 * Environment variables:
 *   TEXTWEB_LLM_URL      - Base URL for OpenAI-compatible API (default: http://localhost:1234/v1)
 *   TEXTWEB_LLM_API_KEY  - API key (optional for local LLMs)
 *   TEXTWEB_LLM_MODEL    - Model name (default: google/gemma-3-4b)
 *   TEXTWEB_LLM_MAX_TOKENS - Max tokens (default: 200)
 *   TEXTWEB_LLM_TEMPERATURE - Temperature (default: 0.7)
 *   TEXTWEB_LLM_TIMEOUT  - Request timeout in ms (default: 60000)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env file if present (lightweight, no dependency)
function loadEnv() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const envPath of candidates) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
      break; // only load first found
    } catch (_) { /* no .env, that's fine */ }
  }
}
loadEnv();

const DEFAULT_CONFIG = {
  baseUrl: process.env.TEXTWEB_LLM_URL || 'http://localhost:1234/v1',
  apiKey: process.env.TEXTWEB_LLM_API_KEY || '',
  model: process.env.TEXTWEB_LLM_MODEL || 'google/gemma-3-4b',
  maxTokens: parseInt(process.env.TEXTWEB_LLM_MAX_TOKENS, 10) || 200,
  temperature: parseFloat(process.env.TEXTWEB_LLM_TEMPERATURE) || 0.7,
  timeout: parseInt(process.env.TEXTWEB_LLM_TIMEOUT, 10) || 60000,
};

// ─── Applicant Background (for prompt context) ─────────────────────────────

const BACKGROUND = `Christopher Robison — Engineering leader with 25+ years of experience.

Current: CTO at D. Harris Tours (transportation management platform, grew fleet from 4 to 16 buses, ~$3.7M revenue)

Key Experience:
- Food.com (1998-2000): Web Architect — built world's first online food ordering service
- Genetic Savings & Clone (2004-2006): VP Engineering — delivered commercially cloned pets
- Mindjet (2007-2010): Web Architect — led SaaS transformation of MindManager
- Conversant/ValueClick (2010-2020): Manager, Software Engineering — mobile ad platform serving 20M+ users/day
- D. Harris Tours (2020-present): CTO — end-to-end transportation management system

Skills: Python, JavaScript, TypeScript, Swift, Kotlin, Rust, Go, C/C++, React, Node.js, AWS, GCP, Docker, Kubernetes, PostgreSQL, MongoDB, Redis. iOS/Android mobile. Infrastructure at scale.

Leadership: Built and managed engineering teams of 5-30. Hired, mentored, promoted. Player-coach who codes daily. Agile/Scrum, CI/CD, platform architecture.

Location: San Francisco, CA. Open to remote.
Available: Immediately.`;

// ─── Answer Generation ──────────────────────────────────────────────────────

/**
 * Generate an answer for a freeform application question
 * 
 * @param {string} question - The question text from the form
 * @param {string} jobDescription - The job posting text (optional)
 * @param {string} company - Company name (optional)
 * @param {object} config - LLM config overrides
 * @returns {string} Generated answer
 */
async function generateAnswer(question, jobDescription, company, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  const systemPrompt = `You are filling out a job application for ${company || 'a company'}. Write a concise, authentic answer to the application question. 

Rules:
- Be specific and genuine, not generic
- Reference real experience from the background provided
- Keep answers 1-3 sentences for short questions, 1-2 paragraphs for essay questions
- Don't be sycophantic or desperate — be confident and direct
- Match the tone to the question (casual if casual, professional if professional)
- For yes/no questions, answer Yes or No then briefly explain if relevant
- For "anything else" or "additional info" questions, keep it brief or say "Nothing additional at this time."`;

  const userPrompt = `APPLICANT BACKGROUND:
${BACKGROUND}

${jobDescription ? `JOB DESCRIPTION:\n${jobDescription.substring(0, 2000)}\n` : ''}
APPLICATION QUESTION: "${question}"

Write the answer (just the answer text, no preamble):`;

  const body = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    stream: false,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(cfg.baseUrl + '/chat/completions');
    const transport = url.protocol === 'https:' ? https : http;
    
    const req = transport.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {}),
      },
      timeout: cfg.timeout || 60000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const answer = json.choices?.[0]?.message?.content?.trim();
          if (!answer) {
            reject(new Error('Empty response from LLM'));
            return;
          }
          resolve(answer);
        } catch (e) {
          reject(new Error(`LLM parse error: ${e.message}`));
        }
      });
    });
    
    req.on('error', (e) => reject(new Error(`LLM request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM request timed out')); });
    req.write(body);
    req.end();
  });
}

/**
 * Batch-generate answers for multiple unknown fields
 * 
 * @param {Array} unknownFields - Array of { ref, field } objects
 * @param {string} jobDescription - Job posting text
 * @param {string} company - Company name
 * @param {object} config - LLM config
 * @returns {Object} Map of ref → answer
 */
async function generateAnswers(unknownFields, jobDescription, company, config = {}) {
  const answers = {};
  
  for (const field of unknownFields) {
    try {
      const answer = await generateAnswer(field.field, jobDescription, company, config);
      answers[field.ref] = answer;
    } catch (err) {
      console.error(`  ⚠️  Failed to generate answer for "${field.field}": ${err.message}`);
      answers[field.ref] = null;
    }
  }
  
  return answers;
}

/**
 * Check if LLM is available
 */
async function checkLLM(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return new Promise((resolve) => {
    const url = new URL(cfg.baseUrl + '/models');
    const transport = url.protocol === 'https:' ? https : http;
    
    const req = transport.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      timeout: 3000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(true));
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

module.exports = { generateAnswer, generateAnswers, checkLLM, BACKGROUND, DEFAULT_CONFIG };
