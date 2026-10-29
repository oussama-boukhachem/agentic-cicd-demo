import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const res = await page.goto('http://127.0.0.1:4200/sign-up', { waitUntil: 'networkidle' });
console.log('status', res.status(), 'url', page.url());
console.log('title', await page.title());
await page.waitForTimeout(1500);
const els = await page.evaluate(() => {
  const sel = 'a,button,input,select,textarea,[role="button"],[role="link"]';
  return Array.from(document.querySelectorAll(sel)).slice(0, 25).map((el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), name: el.getAttribute('name'), ph: el.getAttribute('placeholder'), text: (el.innerText||'').trim().slice(0,40), w: Math.round(r.width), h: Math.round(r.height) };
  });
});
console.log(JSON.stringify(els, null, 1));
console.log('body text:', (await page.innerText('body')).slice(0, 300).replace(/\n+/g, ' | '));
await browser.close();
