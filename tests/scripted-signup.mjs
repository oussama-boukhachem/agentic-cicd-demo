import { chromium } from 'playwright';

// A deliberately classic, selector-based test: the 'before' half of the
// money shot. It asserts the button LABEL, which is exactly what breaks when
// a designer renames it.
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000';
const EMAIL = 'scripted+' + Date.now() + '@example.com';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
  await page.goto(APP_URL + '/sign-up', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Enter your email').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill('Sup3rSecret!9');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click({ timeout: 5000 });
  await page.waitForURL('**/dashboard', { timeout: 8000 });
  console.log('SCRIPTED TEST: PASS - account created for ' + EMAIL);
  process.exit(0);
} catch (err) {
  console.log('SCRIPTED TEST: FAIL - ' + String(err).split('\n')[0]);
  process.exit(1);
} finally {
  await browser.close();
}