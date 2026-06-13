// Run with: node --experimental-vm-modules test_ink.mjs
// playwright is installed globally

const { chromium } = await import('playwright');
const fs = (await import('fs')).default;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgl', '--use-gl=swiftshader']
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });

const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

console.log('Loading page...');
await page.goto('http://localhost:8081/entropy-sim/');
await page.waitForTimeout(2000);

await page.evaluate(() => {
  const s = document.getElementById('speedSlider');
  if (s) { s.value = '0.5'; s.dispatchEvent(new Event('input')); }
});
console.log('Speed = 50%');

await page.locator('#btnDrop').click();
console.log('Drop clicked — waiting 18s for diffusion...');
await page.waitForTimeout(18000);

// Tilt camera down (drag upward on beaker side)
const bbox = await page.locator('#beaker-canvas').boundingBox();
if (bbox) {
  const cx = bbox.x + bbox.width / 2, cy = bbox.y + bbox.height / 2;
  await page.mouse.move(cx, cy + 80);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 100, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

await page.screenshot({ path: 'test_ink_mode.png' });
console.log('INK MODE → test_ink_mode.png');

await page.locator('#btnHeatMode').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test_heat_mode.png' });
console.log('HEAT MODE → test_heat_mode.png');

console.log('Errors:', consoleErrors.length === 0 ? 'none ✓' : consoleErrors);
await browser.close();
console.log('Done.');
