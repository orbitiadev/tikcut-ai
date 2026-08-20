import { expect, test } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const shortWebm = resolve(process.cwd(), 'tests/fixtures/short-6s.webm');

function probeVideoSize(path: string) {
  return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', path], { encoding: 'utf8' }).trim();
}

async function open(page: import('@playwright/test').Page, area: string) {
  await page.goto('/');
  await page.getByRole('button', { name: area, exact: true }).click();
}

test('mobile Editor buttons work after importing a real video', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only functional audit.');
  expect(existsSync(shortWebm)).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(shortWebm);
  await expect(page.getByText('Duração', { exact: true }).locator('..').locator('b')).not.toHaveText('0:00', { timeout: 30_000 });

  await page.getByRole('button', { name: 'clean', exact: true }).click();
  await expect(page.getByRole('button', { name: 'clean', exact: true })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'karaoke', exact: true }).click();
  await expect(page.getByRole('button', { name: 'karaoke', exact: true })).toHaveClass(/active/);

  await page.getByRole('button', { name: 'Detectar pausas/silêncios', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/pausas detectadas dentro do corte selecionado/, { timeout: 90_000 });

  await page.getByLabel('IN segundos').fill('1');
  await page.getByLabel('IN segundos').dispatchEvent('change');
  await page.getByLabel('OUT segundos').fill('3');
  await page.getByLabel('OUT segundos').dispatchEvent('change');

  const cutDownloadPromise = page.waitForEvent('download', { timeout: 4 * 60 * 1000 });
  await page.getByRole('button', { name: 'Cortar vídeo', exact: true }).click();
  const cutDownload = await cutDownloadPromise;
  const cutPath = await cutDownload.path();
  expect(cutPath).toBeTruthy();
  expect(statSync(cutPath!).size).toBeGreaterThan(5_000);
  await expect(page.getByRole('link', { name: 'Baixar corte pronto' })).toBeVisible();

  const verticalDownloadPromise = page.waitForEvent('download', { timeout: 5 * 60 * 1000 });
  await page.getByRole('button', { name: 'Exportar MP4 9:16', exact: true }).click();
  const verticalDownload = await verticalDownloadPromise;
  const verticalPath = await verticalDownload.path();
  expect(verticalPath).toBeTruthy();
  expect(statSync(verticalPath!).size).toBeGreaterThan(10_000);
  expect(probeVideoSize(verticalPath!)).toBe('1080x1920');
  await expect(page.getByRole('status')).toContainText('Vídeo vertical pronto');
  await expect(page.getByRole('link', { name: 'Baixar vídeo 9:16' })).toBeVisible();
});

test('mobile Studio Pro exposes only safe actions and its real engine responds', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only functional audit.');
  expect(existsSync(shortWebm)).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, 'STUDIO PRO');

  await expect(page.getByRole('checkbox', { name: 'Modo compatível móvel', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Renderizar Auto Zoom 9:16', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Criar vídeo Fruit AI local', exact: true })).toBeHidden();

  await page.locator('.source-card input[type="file"]').setInputFiles(shortWebm);
  await expect(page.getByText(/Fonte pronta:/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Studio Pro OUT', { exact: true }).fill('3');

  await page.getByRole('button', { name: 'Testar motor com corte de 2s', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Motor local OK pronto', { timeout: 4 * 60 * 1000 });
  await expect(page.getByLabel('Saída Studio Pro').getByRole('link', { name: 'Baixar resultado' })).toBeVisible();

  await page.locator('.ai-card textarea').fill('Teste móvel do pacote social, Auto Zoom e storyboard de frutas para validar os controles do Studio Pro.');
  await page.getByRole('button', { name: 'Gerar pacote social', exact: true }).click();
  await expect(page.locator('.metadata-output')).toContainText('Hashtags');
  await expect(page.locator('.metadata-output').getByRole('button', { name: 'Copiar pacote' })).toBeHidden();

  await page.getByRole('button', { name: 'Planejar Auto Zoom', exact: true }).click();
  await expect(page.locator('.zoom-list span').first()).toBeVisible();
  await page.getByRole('button', { name: 'Gerar storyboard IA', exact: true }).click();
  await expect(page.locator('.fruit-scenes article').first()).toBeVisible();

  await page.getByRole('button', { name: '+ Texto', exact: true }).click();
  await expect(page.getByLabel('Texto selecionado na timeline')).toBeVisible();
  await page.getByLabel('Texto selecionado na timeline').fill('Texto móvel funcionando');
  await expect(page.getByText('Texto móvel funcionando', { exact: true }).first()).toBeVisible();
});

test('mobile Finalizer handles captions, SRT and a real render', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only functional audit.');
  expect(existsSync(shortWebm)).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, 'FINALIZADOR');
  await page.getByLabel('Importar vídeo no Finalizador').setInputFiles(shortWebm);
  await expect(page.getByRole('status')).toContainText('Vídeo pronto', { timeout: 30_000 });

  await page.getByRole('button', { name: '+ Legenda manual', exact: true }).click();
  await page.getByLabel('Legenda 1 texto').fill('FINALIZADOR MÓVEL OK');
  await page.getByRole('radio', { name: 'clean', exact: true }).check();

  const srtPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar SRT', exact: true }).click();
  const srt = await srtPromise;
  expect(srt.suggestedFilename()).toMatch(/\.srt$/);

  await page.getByTestId('render-final-video').click();
  await expect(page.getByTestId('final-output')).toBeVisible({ timeout: 5 * 60 * 1000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Baixar MP4 final', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  expect(probeVideoSize(path!)).toBe('1080x1920');
});

test('mobile Storyverse creation and export controls work end to end', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only functional audit.');
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, 'STORYVERSE');
  await page.getByRole('button', { name: 'Criar minha primeira série', exact: true }).click();
  await page.getByRole('button', { name: 'Série', exact: true }).click();
  const title = `Série Mobile ${Date.now()}`;
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByLabel('Premissa', { exact: true }).fill('Uma manga inteligente encontra uma porta secreta e precisa descobrir o que existe atrás dela.');

  await page.getByRole('button', { name: 'Personagens', exact: true }).click();
  await page.getByRole('button', { name: '+ Personagem', exact: true }).click();
  await expect(page.locator('.character-card')).toHaveCount(1);

  await page.getByRole('button', { name: 'Universo', exact: true }).click();
  await page.getByRole('button', { name: '+ arco', exact: true }).click();
  await page.getByRole('button', { name: '+ gancho', exact: true }).click();

  await page.getByRole('button', { name: 'Episódios', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar história', exact: true }).click();
  await expect(page.getByText(/EP 01/).first()).toBeVisible();

  const seasonPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar temporada TXT', exact: true }).click();
  expect((await seasonPromise).suggestedFilename()).toMatch(/\.txt$/);
  const jsonPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup JSON', exact: true }).click();
  expect((await jsonPromise).suggestedFilename()).toMatch(/\.json$/);
});
