const { chromium } = require('playwright');

async function tryLogin(request) {
  const candidates = [
    { email: 'admin@local.dev', password: 'admin123' },
    { email: 'demo@local.dev', password: 'demo1234' },
    { email: 'test@test.com', password: 'test1234' },
  ];

  for (const creds of candidates) {
    const response = await request.post('http://localhost:3001/auth/login', {
      data: creds,
    });
    if (response.ok()) {
      const body = await response.json();
      return body.token;
    }
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const request = context.request;
  const token = await tryLogin(request);

  if (token) {
    await context.addInitScript((value) => {
      localStorage.setItem('hcm_land_token', value);
    }, token);
  }

  const page = await context.newPage();
  const tileRequests = [];
  const errors = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/tiles/')) return;
    tileRequests.push({
      url: url.replace('http://localhost:5173', ''),
      status: response.status(),
      size: (await response.body().catch(() => Buffer.alloc(0))).length,
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://localhost:5173/map', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(6000);

  const status = await page.locator('.map-status-text').textContent().catch(() => '');
  const hasCanvas = await page.locator('.maplibre-map canvas').count();

  const failedTiles = tileRequests.filter((t) => t.status !== 200);
  const okTiles = tileRequests.filter((t) => t.status === 200 && t.size > 0);

  console.log('URL:', page.url());
  console.log('Status text:', status);
  console.log('Canvas count:', hasCanvas);
  console.log('Tile requests total:', tileRequests.length);
  console.log('Tiles OK with data:', okTiles.length);
  console.log('Tiles failed:', failedTiles.length);
  if (failedTiles.length) console.log('Failed sample:', failedTiles.slice(0, 5));
  if (okTiles.length) console.log('OK sample:', okTiles.slice(0, 3));
  if (errors.length) console.log('Console errors:', errors.slice(0, 8));

  await page.screenshot({ path: 'scripts/playwright-map.png', fullPage: false });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
