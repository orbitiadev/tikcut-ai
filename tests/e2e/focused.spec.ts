import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const shortWebm = path.resolve('tests/fixtures/short-6s.webm');
const shortH264 = path.resolve('tests/fixtures/short-6s.mp4');
const long125 = path.resolve('tests/fixtures/long-125min-h264.mp4');

async function upload(page: import('@playwright/test').Page, filePath: string) {
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.locator('video')).toBeVisible({ timeout: 30_000 });
}

test('focused product removes unused modules and keeps only cut + history', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /TikCut Auto Cut/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cortar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Histórico/ })).toBeVisible();
  await expect(page.getByText('STUDIO PRO', { exact: true })).toHaveCount(0);
  await expect(page.getByText('FINALIZADOR', { exact: true })).toHaveCount(0);
  await expect(page.getByText('STORYVERSE', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/SALVAMENTO AUTOMÁTICO/)).toBeVisible();
});

test('settings persist after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Quantidade de cortes').fill('13');
  await page.getByLabel('Duração mínima').selectOption('45');
  await page.getByLabel('Duração máxima').selectOption('165');
  await page.getByLabel('Formato de saída').selectOption('vertical');
  await page.getByLabel('Prefixo dos arquivos').fill('meus-cortes');
  await page.reload();
  await expect(page.getByLabel('Quantidade de cortes')).toHaveValue('13');
  await expect(page.getByLabel('Duração mínima')).toHaveValue('45');
  await expect(page.getByLabel('Duração máxima')).toHaveValue('165');
  await expect(page.getByLabel('Formato de saída')).toHaveValue('vertical');
  await expect(page.getByLabel('Prefixo dos arquivos')).toHaveValue('meus-cortes');
});

test('project queue is saved and recoverable after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Quantidade de cortes').fill('4');
  await upload(page, shortWebm);
  await page.getByRole('button', { name: 'Gerar nova seleção automática' }).click();
  await expect(page.locator('.focus-cut')).toHaveCount(4);
  await page.reload();
  await expect(page.getByText('Projeto salvo encontrado')).toBeVisible();
  await expect(page.getByText(/short-6s\.webm/)).toBeVisible();
  await upload(page, shortWebm);
  await expect(page.getByText(/Projeto restaurado: 4 cortes salvos/)).toBeVisible();
  await expect(page.locator('.focus-cut')).toHaveCount(4);
});

test('manual mode adds a chosen interval to the queue', async ({ page }) => {
  await page.goto('/');
  await upload(page, shortWebm);
  await page.getByRole('button', { name: 'Manual' }).click();
  await page.getByLabel('IN segundos').fill('1');
  await page.getByLabel('OUT segundos').fill('4');
  await page.getByRole('button', { name: 'Adicionar à fila' }).click();
  await expect(page.getByText(/1:?[0-9]* → 0:04|0:01 → 0:04/)).toBeVisible();
  await expect(page.getByText(/Corte manual/).first()).toBeVisible();
});

test('mobile layout does not overflow at narrow widths', async ({ page }) => {
  for (const width of [320, 360, 412]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/');
    const metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(metrics.scroll, `overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewport + 1);
  }
});

test('mobile can render a real short cut and keep it in history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await page.route('**/ffmpeg/ffmpeg-core.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('Quantidade de cortes').fill('1');
  await upload(page, shortWebm);
  await page.getByRole('button', { name: 'Gerar nova seleção automática' }).click();
  await expect(page.locator('.focus-cut')).toHaveCount(1);
  await page.getByRole('button', { name: /GERAR 1 CORTE$/ }).click();

  const progressBar = page.getByRole('progressbar', { name: 'Progresso da geração' });
  await expect(progressBar).toBeVisible({ timeout: 5_000 });
  await expect(progressBar).not.toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.focus-generate')).not.toContainText('0%');
  await expect(page.locator('.focus-generate')).toHaveText(/Preparando motor de vídeo|Gerando|Salvando/);

  await expect(page.getByText(/1 corte\(s\) prontos/)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('button', { name: /Baixar/ }).first()).toBeEnabled();
  await page.getByRole('button', { name: /Histórico/ }).click();
  await expect(page.locator('.focus-history-item')).toHaveCount(1);
  await expect(page.locator('.focus-history-item').getByText(/MP4 salvo|somente histórico/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Histórico/ }).click();
  await expect(page.locator('.focus-history-item')).toHaveCount(1);
});

test('Chrome cuts a real source longer than two hours without processing the whole file', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop');
  await page.goto('/');
  await page.getByLabel('Quantidade de cortes').fill('1');
  await page.getByLabel('Duração mínima').selectOption('30');
  await page.getByLabel('Duração máxima').selectOption('30');
  await upload(page, long125);
  await expect(page.getByText(/2H\+ OK/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Gerar nova seleção automática' }).click();
  await expect(page.locator('.focus-cut')).toHaveCount(1);
  await page.getByRole('button', { name: /GERAR 1 CORTE$/ }).click();
  await expect(page.getByText(/1 corte\(s\) prontos/)).toBeVisible({ timeout: 180_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.focus-cut').getByRole('button', { name: /Baixar/ }).click();
  const download = await downloadPromise;
  const outputPath = path.join(os.tmpdir(), `tikcut-2h-${Date.now()}.mp4`);
  await download.saveAs(outputPath);
  const outputDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outputPath], { encoding: 'utf8' }).trim());
  // The fast stream-copy path can begin on an earlier keyframe. This synthetic
  // 0.25fps fixture intentionally has an extreme GOP, so validate that the
  // result is still a bounded short clip rather than requiring frame-exact 30s.
  expect(outputDuration).toBeGreaterThan(15);
  expect(outputDuration).toBeLessThan(100);
});

test('Chrome persists a generated MP4 in IndexedDB history when storage allows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop');
  await page.goto('/');
  await page.getByLabel('Quantidade de cortes').fill('1');
  await upload(page, shortH264);
  await page.getByRole('button', { name: 'Gerar nova seleção automática' }).click();
  await page.getByRole('button', { name: /GERAR 1 CORTE$/ }).click();
  await expect(page.getByText(/1 corte\(s\) prontos/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole('button', { name: /Histórico/ }).click();
  const item = page.locator('.focus-history-item').first();
  await expect(item).toBeVisible();
  const download = item.getByRole('button', { name: 'Baixar' });
  await expect(download).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: /Histórico/ }).click();
  await expect(page.locator('.focus-history-item').first().getByRole('button', { name: 'Baixar' })).toBeEnabled();
});