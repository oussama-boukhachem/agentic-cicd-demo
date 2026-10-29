import { Stagehand, localBrowser } from '@browserbasehq/stagehand';

const url = process.env.APP_URL || 'http://127.0.0.1:4200';
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({
  browser,
  model: {
    modelName: process.env.AGENT_MODEL || 'deepseek/deepseek-chat',
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  }
});
const [page] = await browser.context.pages();
await page.goto(url + '/sign-up');
console.log('title:', await page.title());
await stagehand.act('Fill the sign up form with name "Agent Demo", email "agent.demo@example.com" and password "Sup3rSecret!" and submit it.');
await page.waitForTimeout(2000);
console.log('after act url:', page.url());
await browser.close();
