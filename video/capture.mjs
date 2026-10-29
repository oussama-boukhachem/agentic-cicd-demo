import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';

const [, , mode, out, a, b, c] = process.argv;
const tmp = '/tmp/sh-capture';
mkdirSync(tmp, { recursive: true });

const CSS = [
  '* { box-sizing: border-box; margin: 0; padding: 0; }',
  'html, body { width: 1280px; height: 720px; overflow: hidden; background: #0b0d10; }',
  "body { font-family: ui-sans-serif, -apple-system, 'Segoe UI', sans-serif; color: #e8eaed; display: flex; align-items: center; justify-content: center; }",
  '.wrap { width: 100%; padding: 64px; }',
  '.kicker { font: 600 16px/1.4 ui-monospace, monospace; letter-spacing: .22em; text-transform: uppercase; color: #ff7a1a; margin-bottom: 18px; }',
  'h1 { font-size: 62px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.06; }',
  'p.sub { margin-top: 18px; font-size: 24px; color: #9aa0a6; line-height: 1.4; }',
  '.rule { width: 96px; height: 4px; background: #ff7a1a; margin: 24px 0; border-radius: 2px; }',
  ".term { font: 500 17px/1.5 ui-monospace, 'JetBrains Mono', monospace; white-space: pre-wrap; color: #d7dae0; width: 100%; }",
  '.term .ok { color: #3ddc84; } .term .bad { color: #ff5c5c; } .term .dim { color: #7a8087; }',
  '.term .cmd { color: #7cc4ff; }',
  '.fade { animation: fade .7s ease both; } @keyframes fade { from { opacity: 0 } to { opacity: 1 } }',
  '.flow { display: flex; align-items: stretch; gap: 14px; margin-top: 34px; }',
  '.box { flex: 1; border: 1px solid #2a2f36; background: #12161b; border-radius: 10px; padding: 16px 14px; }',
  '.box.hot { border-color: #ff7a1a; box-shadow: 0 0 0 1px #ff7a1a inset; }',
  '.box .n { font: 600 12px/1 ui-monospace, monospace; color: #ff7a1a; }',
  '.box .t { margin-top: 10px; font-size: 18px; font-weight: 600; }',
  '.box .d { margin-top: 6px; font-size: 13px; color: #8b9198; line-height: 1.35; }',
  '.arrow { align-self: center; color: #4a5058; font-size: 20px; }'
].join('\n');

const STAGES = [
  ['1', 'Lint + types', 'tsc, eslint'],
  ['2', 'Build', 'next build'],
  ['3', 'Agentic E2E', 'LLM drives the UI'],
  ['4', 'Image', 'GHCR push'],
  ['5', 'Deploy', 'vps-b over SSH'],
  ['6', 'Smoke', 'health + DB']
];

function titleHtml(main, sub) {
  return '<div class="wrap fade"><div class="kicker">AGENTIC CI/CD</div><h1>' + main +
    '</h1><div class="rule"></div><p class="sub">' + (sub || '') + '</p></div>';
}

function diagramHtml() {
  const boxes = STAGES.map((s, i) =>
    '<div class="box' + (i === 2 ? ' hot' : '') + '"><div class="n">STAGE ' + s[0] +
    '</div><div class="t">' + s[1] + '</div><div class="d">' + s[2] + '</div></div>' +
    (i < STAGES.length - 1 ? '<div class="arrow">&#8594;</div>' : '')).join('');
  return '<div class="wrap fade"><div class="kicker">PIPELINE</div><h1>Six stages, one agent</h1>' +
    '<div class="flow">' + boxes + '</div></div>';
}

const isTitle = mode === 'title';
const isDiagram = mode === 'diagram';
const seconds = Number(isTitle || isDiagram ? (c || 5) : (c || 12));
const pageHtml = isTitle ? titleHtml(a, b) : isDiagram ? diagramHtml() : '<div class="wrap"><pre class="term" id="t"></pre></div>';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: tmp, size: { width: 1280, height: 720 } }
});
const page = await context.newPage();
await page.setContent('<style>' + CSS + '</style>' + pageHtml);

if (!isTitle && !isDiagram) {
  const lines = readFileSync(a, 'utf8').split('\n').slice(0, 26);
  await page.evaluate(async (payload) => {
    const el = document.getElementById('t');
    const per = Math.min(900, (payload.seconds * 1000) / Math.max(payload.lines.length, 1));
    for (const line of payload.lines) {
      const d = document.createElement('div');
      d.className = line.startsWith('$') ? 'cmd'
        : (/PASS|success|ok\b/.test(line) ? 'ok'
        : (/FAIL|error|Error/.test(line) ? 'bad' : (/^(-|\s)/.test(line) ? 'dim' : '')));
      d.textContent = line || ' ';
      el.appendChild(d);
      await new Promise((r) => setTimeout(r, per));
    }
  }, { lines, seconds });
}

// Terminal scenes already spend `seconds` animating; only top up the tail.
await page.waitForTimeout(isTitle || isDiagram ? seconds * 1000 : 800);
const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();

const outPath = out.endsWith('.mp4') ? out : out + '.mp4';
rmSync(outPath, { force: true });
// Keep intermediates at 720p; the final assembly upscales once.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw,
  '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', outPath]);
console.log('wrote ' + outPath);