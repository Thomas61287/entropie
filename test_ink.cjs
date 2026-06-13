const { chromium } = require('C:/Users/Thoma/AppData/Roaming/npm/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

  await page.goto('http://localhost:8081/entropy-sim/');
  await page.waitForTimeout(2000);

  // Inject at middle of water column (y=16), large radius, run 80 steps
  const result = await page.evaluate(() => {
    if (!viewer3d || !viewer3d._vol) return { ok: false, reason: 'no viewer3d' };

    // Inject at center of grid (x=16, y=16 = mid-water, z=16), radius 5
    viewer3d._vol.inject(16, 16, 16, 5, 1.0, 0.80);
    viewer3d._vol.hasInk = true;

    // 80 steps keeps peak density high while showing some spreading
    for (let i = 0; i < 80; i++) viewer3d._vol.step(0.02, 1.0);

    const ink = viewer3d._vol.ink;
    let maxD = 0, nonZero = 0, sumD = 0;
    for (let i = 0; i < ink.length; i++) {
      if (ink[i] > 0.005) { nonZero++; sumD += ink[i]; if (ink[i] > maxD) maxD = ink[i]; }
    }

    // Force render update — explicitly update ink layers and render
    if (viewer3d._updateInkLayers) viewer3d._updateInkLayers();
    if (viewer3d._renderer && viewer3d.scene && viewer3d.camera) {
      viewer3d._renderer.render(viewer3d.scene, viewer3d.camera);
    }

    return {
      ok: true,
      maxD: Math.round(maxD * 1000) / 1000,
      nonZero,
      avgD: nonZero > 0 ? Math.round(sumD / nonZero * 1000) / 1000 : 0,
      hasInk: viewer3d._vol.hasInk
    };
  });
  console.log('Sim state after inject:', JSON.stringify(result));

  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test_ink_mode.png' });
  console.log('INK MODE → test_ink_mode.png');

  // Switch to heat mode via JS (avoids viewport click issues)
  const heatResult = await page.evaluate(() => {
    if (viewer3d) viewer3d.setHeatMode(true);
    if (viewer3d._updateInkLayers) viewer3d._updateInkLayers();
    if (viewer3d._renderer && viewer3d.scene && viewer3d.camera) {
      viewer3d._renderer.render(viewer3d.scene, viewer3d.camera);
    }
    return { heatMode: viewer3d ? viewer3d._showHeat : 'n/a' };
  });
  console.log('Heat mode set:', JSON.stringify(heatResult));

  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test_heat_mode.png' });
  console.log('HEAT MODE → test_heat_mode.png');

  console.log('Errors:', consoleErrors.length === 0 ? 'none ✓' : consoleErrors.slice(0, 5));
  await browser.close();
  console.log('Done.');
})();
