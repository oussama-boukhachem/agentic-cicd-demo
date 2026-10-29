/**
 * Agentic E2E journey.
 *
 * A text-only LLM is given a plain-English goal and a snapshot of the live DOM.
 * It chooses one tool call per turn; Playwright executes it. The run is scored
 * by SQL against Postgres - not by the model's own opinion.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000';
const LLM_BASE = process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5vl:3b';
const LLM_KEY = process.env.LLM_API_KEY || 'local';
const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 14);
const EMAIL = process.env.AGENT_EMAIL || `agent+${Date.now()}@example.com`;
const INVITEE = process.env.AGENT_INVITEE || `teammate+${Date.now()}@example.com`;

const tools = [
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click the interactive element with this index.',
      parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fill',
      description: 'Type text into the input with this index (clears it first).',
      parameters: {
        type: 'object',
        properties: { index: { type: 'number' }, value: { type: 'string' } },
        required: ['index', 'value']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'goto',
      description: 'Navigate to a path on the app, e.g. /sign-up',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Report the goal as complete once the final screen confirms it.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }
    }
  }
];

async function snapshot(page) {
  return page.evaluate(() => {
    const sel = 'a,button,input,select,textarea,[role="button"],[role="link"]';
    const nodes = Array.from(document.querySelectorAll(sel));
    let i = 0;
    const out = [];
    for (const el of nodes) {
      if (el.disabled) continue;
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      if (!visible) continue;
      el.setAttribute('data-agent-idx', String(i));
      out.push({
        index: i,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        placeholder: el.getAttribute('placeholder') || '',
        name: el.getAttribute('name') || '',
        aria: el.getAttribute('aria-label') || ''
      });
      i += 1;
      if (i >= 60) break;
    }
    return out;
  });
}

let toolMode = process.env.AGENT_TOOL_MODE !== 'json';

const JSON_CONTRACT = '\nReply with ONLY a JSON object: {"tool":"click|fill|goto|done","args":{...}}. No prose.';

async function ask(messages) {
  const body = { model: LLM_MODEL, messages, temperature: 0 };
  if (toolMode) {
    body.tools = tools;
    body.tool_choice = 'auto';
  } else {
    body.messages = messages.map((m, i) =>
      i === 0 ? { role: 'system', content: m.content + JSON_CONTRACT } : m
    );
  }
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    // Local models frequently lack native tool support: drop to a JSON contract.
    if (toolMode && /does not support tools|tools are not supported/i.test(text)) {
      toolMode = false;
      console.log('LLM has no tool support -> switching to JSON contract mode');
      return ask(messages);
    }
    throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const msg = json.choices[0].message;
  if (toolMode) return msg;
  const match = String(msg.content || '').match(/\{[\s\S]*\}/);
  if (!match) return { content: msg.content };
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    // A malformed turn is a wasted step, not a crashed run.
    return { content: 'invalid JSON: ' + match[0].slice(0, 160) };
  }
  return {
    content: '',
    tool_calls: [
      {
        id: 'json-' + Date.now(),
        type: 'function',
        function: { name: parsed.tool, arguments: JSON.stringify(parsed.args || {}) }
      }
    ]
  };
}

// Descriptors from the last snapshot: re-resolve them at action time so a
// React re-render between "model sees the page" and "we click" cannot orphan
// a data-agent-idx attribute.
function locatorFor(page, el) {
  if (!el) return null;
  if (el.placeholder) return page.getByPlaceholder(el.placeholder, { exact: false }).first();
  if (el.name && ['input', 'textarea', 'select'].includes(el.tag)) {
    return page.locator(`${el.tag}[name="${el.name}"]`).first();
  }
  if (el.text) {
    const role = el.tag === 'a' ? 'link' : el.tag === 'button' ? 'button' : null;
    if (role) return page.getByRole(role, { name: el.text, exact: false }).first();
  }
  return page.locator(`[data-agent-idx="${el.index}"]`).first();
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const log = [];

const messages = [
  {
    role: 'system',
    content: [
      'You are a meticulous QA agent driving a web app through tools.',
      'Rules: one tool call per turn. Use only indices from the ELEMENTS list.',
      'If the goal involves a form, fill every required field before submitting.',
      'After submitting, confirm the resulting screen before calling done.',
      'If an action fails, inspect the new ELEMENTS list and try another approach.'
    ].join(' ')
  },
  {
    role: 'user',
    content: `GOAL: Create an account with email ${EMAIL} and password Sup3rSecret!9 (start at /sign-up). After signup you land on the dashboard. Then use the "Invite Team Member" card on that dashboard to invite ${INVITEE} with role member, and press "Invite Member". You are done when the invitation is confirmed on screen.`
  }
];

let lastElements = [];
let finished = false;
let summary = '';
try {
  await page.goto(APP_URL + '/sign-up', { waitUntil: 'domcontentloaded' });
  for (let step = 1; step <= MAX_STEPS && !finished; step += 1) {
    const elements = await snapshot(page);
    lastElements = elements;
    messages.push({
      role: 'user',
      content: `STEP ${step}\nURL: ${page.url()}\nELEMENTS: ${JSON.stringify(elements)}\nWhat is the single next action?`
    });
    const msg = await ask(messages);
    const call = msg.tool_calls?.[0];
    if (!call) {
      log.push(`step ${step}: no tool call -> ${(msg.content || '').slice(0, 120)}`);
      messages.push({ role: 'assistant', content: msg.content || '' });
      continue;
    }
    const name = call.function.name;
    const args = JSON.parse(call.function.arguments || '{}');
    messages.push({ role: 'assistant', content: '', tool_calls: [call] });
    let result = 'ok';
    try {
      if (name === 'click') {
        const el = locatorFor(page, lastElements[args.index]);
        if (!el) throw new Error('bad index ' + args.index);
        await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await el.click({ timeout: 8000 });
      } else if (name === 'fill') {
        const el = locatorFor(page, lastElements[args.index]);
        if (!el) throw new Error('bad index ' + args.index);
        await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await el.fill(args.value, { timeout: 8000 });
      } else if (name === 'goto') {
        await page.goto(new URL(args.path, APP_URL).toString(), { waitUntil: 'domcontentloaded' });
      } else if (name === 'done') {
        finished = true;
        summary = args.summary;
      }
      await page.waitForTimeout(700);
    } catch (err) {
      result = 'ERROR: ' + String(err).split('\n')[0].slice(0, 160);
    }
    log.push(`step ${step}: ${name} ${JSON.stringify(args)} -> ${result}`);
    messages.push({ role: 'tool', tool_call_id: call.id, content: result });
  }
} finally {
  await page.screenshot({ path: 'agent-final.png', fullPage: false }).catch(() => {});
  await browser.close();
}

console.log(log.join('\n'));
console.log('agent finished:', finished, '-', summary);
console.log('email used:', EMAIL);

let dbOk = false;
if (process.env.POSTGRES_URL) {
  const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
  const rows = await sql`
    select i.email, i.role, i.status
    from invitations i
    where i.email = ${INVITEE}
    order by i.id desc
    limit 1
  `;
  await sql.end();
  dbOk = rows.length > 0;
  console.log('db rows:', JSON.stringify(rows));
  console.log('DB ORACLE:', dbOk ? 'PASS' : 'FAIL');
}

process.exit(dbOk || !process.env.POSTGRES_URL ? 0 : 1);
