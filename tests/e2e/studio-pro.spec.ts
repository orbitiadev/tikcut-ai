import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const longWebm = resolve(process.cwd(), 'tests/fixtures/long-65min.webm');
const shortWebm = resolve(process.cwd(), 'tests/fixtures/short-6s.webm');
const mockPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8AARAwMDAxQAQYAHAABf8sQ6QAAAABJRU5ErkJggg==', 'base64');

async function openStudio(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'STUDIO PRO', exact: true }).click();
  await expect(page.getByRole('heading', { name: /STUDIO PRO/ })).toBeVisible();
}

async function mockCommons(page: import('@playwright/test').Page) {
  await page.route('https://commons.wikimedia.org/w/api.php?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: {
          pages: {
            '1': {
              pageid: 1,
              title: 'File:TikCut QA B-roll.png',
              imageinfo: [{
                url: 'https://mock.tikcut.test/broll.png',
                thumburl: 'https://mock.tikcut.test/broll.png',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:TikCut_QA_B-roll.png',
                extmetadata: {
                  ImageDescription: { value: 'TikCut QA image' },
                  Artist: { value: 'TikCut QA' },
                  LicenseShortName: { value: 'CC0' },
                  LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' },
                },
              }],
            },
          },
        },
      }),
    });
  });
  await page.route('https://mock.tikcut.test/broll.png', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: mockPng });
  });
}

function probeDuration(path: string) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path], { encoding: 'utf8' }).trim());
}

function probeVideoSize(path: string) {
  return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', path], { encoding: 'utf8' }).trim();
}

test('Studio Pro exposes advanced modules and five editable timeline layers', async ({ page }, testInfo) => {
  await openStudio(page);
  await expect(page.getByText('Transcrição automática completa', { exact: false })).toBeVisible();
  await expect(page.getByText('Remoção automática de silêncios', { exact: false })).toBeVisible();
  await expect(page.getByText('Auto Zoom inteligente', { exact: false })).toBeVisible();
  await expect(page.getByText('Auto B-roll licenciado', { exact: false })).toBeVisible();
  await expect(page.getByText('AUTOPILOT completo', { exact: false })).toBeVisible();
  await expect(page.getByText('Criar com IA · Fruit AI', { exact: false })).toBeVisible();
  const broll = page.getByRole('checkbox', { name: 'Incorporar B-roll', exact: true });
  if (testInfo.project.name === 'chromium-mobile') {
    await expect(page.getByRole('checkbox', { name: 'Modo compatível móvel', exact: true })).toBeChecked();
    await expect(broll).not.toBeChecked();
    await expect(broll).toBeDisabled();
  } else {
    await expect(broll).toBeChecked();
  }
  await expect(page.getByLabel('Timeline profissional multicamada')).toBeVisible();
  for (const label of ['VÍDEO', 'B-ROLL', 'TEXTO', 'ÁUDIO', 'ZOOM/FX']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});

test('metadata, B-roll planning and Fruit AI storyboard work with local AI or fallback', async ({ page }) => {
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
  await expect(page.locator('.fruit-scenes')).toContainText('Cena 1');
  expect(await page.locator('.fruit-scenes article').count()).toBeGreaterThanOrEqual(2);
});

test('long video can build a smart zoom plan without losing the selected source', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium-mobile', 'Long source planning is covered on desktop.');
  expect(existsSync(longWebm)).toBeTruthy();
  await openStudio(page);
  await page.locator('.source-card input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT', { exact: true }).fill('123');
  await page.getByLabel('Studio Pro IN', { exact: true }).fill('120');
  await expect(page.locator('.pro-stats')).toContainText('Trecho 0:03');
  await page.getByRole('button', { name: 'Planejar Auto Zoom', exact: true }).click();
  await expect(page.locator('.zoom-list span').first()).toBeVisible();
  await expect(page.getByRole('status')).toContainText('movimentos de Auto Zoom');
  await expect(page.locator('.source-card video')).toHaveAttribute('src', /^blob:/);
});

test('Studio Pro removes silence only from selected range and produces a shorter MP4', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Heavy silence render runs once.');
  expect(existsSync(longWebm)).toBeTruthy();
  await openStudio(page);
  await page.locator('.source-card input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT', { exact: true }).fill('14');
  await page.getByLabel('Studio Pro IN', { exact: true }).fill('0');
  await page.getByRole('checkbox', { name: 'Gerar saída vertical 9:16', exact: true }).uncheck();

  await page.getByRole('button', { name: 'Detectar todos os silêncios', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('dentro do trecho selecionado', { timeout: 3 * 60 * 1000 });
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

test('Autopilot renders a vertical edit and bakes licensed B-roll into the final MP4', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop', 'Full Autopilot+B-roll render is validated once in branded Chrome.');
  expect(existsSync(longWebm)).toBeTruthy();
  await mockCommons(page);
  await openStudio(page);
  await page.locator('.source-card input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT', { exact: true }).fill('123');
  await page.getByLabel('Studio Pro IN', { exact: true }).fill('120');
  await page.locator('.ai-card textarea').fill('Presta atenção agora! Este é um teste curto de edição automática com ritmo, zoom e imagem complementar.');
  await page.getByRole('checkbox', { name: 'Transcrever se necessário', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Remover silêncios', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '9:16', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Auto Zoom', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Incorporar B-roll', exact: true }).check();

  await page.getByRole('button', { name: 'EXECUTAR AUTOPILOT', exact: true }).click();
  const resultLink = page.getByLabel('Saída Studio Pro').getByRole('link', { name: 'Baixar resultado' });
  await expect(resultLink).toBeVisible({ timeout: 5 * 60 * 1000 });
  await expect(page.getByRole('status')).toContainText('Autopilot storytime + B-roll pronto');
  await expect(page.getByLabel('Timeline profissional multicamada').locator('.item-broll').first()).toBeVisible();

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

test('mobile safe mode performs a real Studio Pro Autopilot render at 720x1280', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-safe render runs only in the mobile project.');
  expect(existsSync(shortWebm)).toBeTruthy();
  await openStudio(page);
  await expect(page.getByRole('checkbox', { name: 'Modo compatível móvel', exact: true })).toBeChecked();
  await page.locator('.source-card input[type="file"]').setInputFiles(shortWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT', { exact: true }).fill('3');
  await page.locator('.ai-card textarea').fill('Teste móvel curto do Studio Pro com saída vertical leve.');
  await page.getByRole('checkbox', { name: 'Remover silêncios', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '9:16', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Auto Zoom', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Incorporar B-roll', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'EXECUTAR AUTOPILOT', exact: true }).click();
  const resultLink = page.getByLabel('Saída Studio Pro').getByRole('link', { name: 'Baixar resultado' });
  await expect(resultLink).toBeVisible({ timeout: 4 * 60 * 1000 });
  await expect(page.getByRole('status')).toContainText('720×1280');

  const downloadPromise = page.waitForEvent('download');
  await resultLink.click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  expect(probeVideoSize(path!)).toBe('720x1280');
  const outputDuration = probeDuration(path!);
  expect(outputDuration).toBeGreaterThan(2.3);
  expect(outputDuration).toBeLessThan(3.8);
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
