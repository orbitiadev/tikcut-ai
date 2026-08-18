import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const longWebm = resolve(process.cwd(), 'tests/fixtures/long-65min.webm');

async function openStudio(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'STUDIO PRO', exact: true }).click();
  await expect(page.getByRole('heading', { name: /STUDIO PRO/ })).toBeVisible();
}

function probeDuration(path: string) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path], { encoding: 'utf8' }).trim());
}

test('Studio Pro exposes advanced modules and five editable timeline layers', async ({ page }) => {
  await openStudio(page);
  await expect(page.getByText('Transcrição automática completa', { exact: false })).toBeVisible();
  await expect(page.getByText('Remoção automática de silêncios', { exact: false })).toBeVisible();
  await expect(page.getByText('Auto Zoom inteligente', { exact: false })).toBeVisible();
  await expect(page.getByText('Auto B-roll licenciado', { exact: false })).toBeVisible();
  await expect(page.getByText('AUTOPILOT completo', { exact: false })).toBeVisible();
  await expect(page.getByText('Criar com IA · Fruit AI', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Timeline profissional multicamada')).toBeVisible();
  for (const label of ['VÍDEO', 'B-ROLL', 'TEXTO', 'ÁUDIO', 'ZOOM/FX']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});

test('metadata, B-roll planning and Fruit AI storyboard have offline fallback behavior', async ({ page }) => {
  await openStudio(page);
  const transcript = 'Você precisa ver este detalhe agora! Um tubarão consegue detectar campos elétricos no oceano e isso muda a forma como ele encontra alimento. No final existe uma descoberta surpreendente.';
  await page.locator('.ai-card textarea').fill(transcript);

  await page.getByRole('button', { name: 'Gerar pacote social', exact: true }).click();
  await expect(page.locator('.metadata-output')).toBeVisible();
  await expect(page.locator('.metadata-output')).toContainText('Hashtags');
  await expect(page.locator('.metadata-output')).toContainText('#');

  await page.getByRole('button', { name: 'Sugerir pontos de B-roll', exact: true }).click();
  await expect(page.locator('.broll-query-list article').first()).toBeVisible();

  await page.getByRole('button', { name: 'Gerar storyboard IA', exact: true }).click();
  await expect(page.locator('.fruit-scenes article')).toHaveCount(4);
  await expect(page.locator('.fruit-scenes')).toContainText('Cena 1');
});

test('long video can build a smart zoom plan without losing the selected source', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium-mobile', 'Long source planning is covered on desktop.');
  expect(existsSync(longWebm)).toBeTruthy();
  await openStudio(page);
  await page.locator('.source-card input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT').fill('123');
  await page.getByLabel('Studio Pro IN').fill('120');
  await expect(page.getByText('Trecho').locator('..')).toContainText('0:03');
  await page.getByRole('button', { name: 'Planejar Auto Zoom', exact: true }).click();
  await expect(page.locator('.zoom-list span').first()).toBeVisible();
  await expect(page.getByRole('status')).toContainText('movimentos de Auto Zoom');
  await expect(page.locator('.source-card video')).toHaveAttribute('src', /^blob:/);
});

test('Studio Pro removes detected silence and produces a shorter MP4', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Heavy silence render runs once.');
  expect(existsSync(longWebm)).toBeTruthy();
  await openStudio(page);
  await page.locator('.source-card input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT').fill('14');
  await page.getByLabel('Studio Pro IN').fill('0');
  await page.getByLabel('Gerar saída vertical 9:16').uncheck();

  await page.getByRole('button', { name: 'Detectar todos os silêncios', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('silêncios detectados', { timeout: 3 * 60 * 1000 });
  await page.getByRole('button', { name: 'Remover TODOS os silêncios', exact: true }).click();
  await expect(page.getByLabel('Saída Studio Pro').getByRole('link', { name: 'Baixar resultado' })).toBeVisible({ timeout: 4 * 60 * 1000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByLabel('Saída Studio Pro').getByRole('link', { name: 'Baixar resultado' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  const outputDuration = probeDuration(path!);
  expect(outputDuration).toBeGreaterThan(7);
  expect(outputDuration).toBeLessThan(13);
});

test('Autopilot can render a short vertical edit without cloud AI or Whisper', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop', 'Autopilot render is validated once in branded Chrome.');
  expect(existsSync(longWebm)).toBeTruthy();
  await openStudio(page);
  await page.locator('.source-card input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT').fill('123');
  await page.getByLabel('Studio Pro IN').fill('120');
  await page.locator('.ai-card textarea').fill('Presta atenção agora! Este é um teste curto de edição automática com ritmo e zoom.');
  await page.getByLabel('Transcrever se necessário').uncheck();
  await page.getByLabel('Remover silêncios').uncheck();
  await page.getByLabel('9:16').check();
  await page.getByLabel('Auto Zoom').check();

  await page.getByRole('button', { name: 'EXECUTAR AUTOPILOT', exact: true }).click();
  const resultLink = page.getByLabel('Saída Studio Pro').getByRole('link', { name: 'Baixar resultado' });
  await expect(resultLink).toBeVisible({ timeout: 4 * 60 * 1000 });
  await expect(page.getByRole('status')).toContainText('Autopilot storytime pronto');

  const downloadPromise = page.waitForEvent('download');
  await resultLink.click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  const outputDuration = probeDuration(path!);
  expect(outputDuration).toBeGreaterThan(2.2);
  expect(outputDuration).toBeLessThan(4.5);
});

test('mobile navigation includes Studio Pro without document horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-specific assertion.');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'STUDIO PRO', exact: true })).toBeVisible();
  const sizes = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 2);
  await page.getByRole('button', { name: 'STUDIO PRO', exact: true }).click();
  await expect(page.getByRole('heading', { name: /STUDIO PRO/ })).toBeVisible();
});
