import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const shortVideo = resolve(process.cwd(), 'tests/fixtures/short-6s.mp4');
const shortWebm = resolve(process.cwd(), 'tests/fixtures/short-6s.webm');
const music = resolve(process.cwd(), 'tests/fixtures/music-2s.wav');

function probeDuration(path: string) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path], { encoding: 'utf8' }).trim());
}

function probeVideoSize(path: string) {
  return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', path], { encoding: 'utf8' }).trim();
}

function probeAudioCodec(path: string) {
  return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nk=1:nw=1', path], { encoding: 'utf8' }).trim();
}

function captionRegionMaxLuma(path: string) {
  const pixels = execFileSync('ffmpeg', [
    '-v', 'error', '-ss', '1', '-i', path,
    '-vf', 'crop=1080:620:0:1180,format=gray',
    '-frames:v', '1', '-f', 'rawvideo', 'pipe:1',
  ]);
  let max = 0;
  for (const value of pixels.values()) if (value > max) max = value;
  return max;
}

async function setRange(page: import('@playwright/test').Page, label: string, value: number) {
  await page.getByLabel(label).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('Finalizer burns captions into a real 1080x1920 MP4 and mixes music', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop', 'Final H.264/AAC compositor is validated once in branded Chrome.');
  expect(existsSync(shortVideo)).toBeTruthy();
  expect(existsSync(music)).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'FINALIZADOR' }).click();
  await expect(page.getByRole('heading', { name: /FINALIZADOR/ })).toBeVisible();

  await page.getByLabel('Importar vídeo no Finalizador').setInputFiles(shortVideo);
  await expect(page.getByRole('status')).toContainText('Vídeo pronto', { timeout: 30_000 });

  await page.getByRole('button', { name: '+ Legenda manual' }).click();
  await page.getByLabel('Legenda 1 texto').fill('TIKCUT FINAL FUNCIONANDO');
  await page.getByLabel('Legenda 1 início').fill('0.5');
  await page.getByLabel('Legenda 1 fim').fill('2.5');
  await page.getByLabel('Adicionar música ao vídeo final').setInputFiles(music);
  await setRange(page, 'Volume da música', 0.35);
  await setRange(page, 'Volume do áudio original', 0.55);

  await page.getByTestId('render-final-video').click();
  await expect(page.getByTestId('final-output')).toBeVisible({ timeout: 4 * 60 * 1000 });
  await expect(page.getByRole('status')).toContainText('legendas realmente incorporadas ao MP4');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Baixar MP4 final' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(download.suggestedFilename()).toMatch(/tikcut-final-tiktok-.*\.mp4$/);
  expect(statSync(path!).size).toBeGreaterThan(20_000);

  const duration = probeDuration(path!);
  expect(duration).toBeGreaterThan(5.2);
  expect(duration).toBeLessThan(6.8);
  expect(probeVideoSize(path!)).toBe('1080x1920');
  expect(probeAudioCodec(path!)).toBe('aac');
  expect(captionRegionMaxLuma(path!)).toBeGreaterThan(180);
});

test('Finalizer can import SRT, edit timing/text, preview styles and export SRT', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium-mobile', 'Desktop form behavior is covered once per desktop engine.');
  expect(existsSync(shortWebm)).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'FINALIZADOR' }).click();
  await page.getByLabel('Importar vídeo no Finalizador').setInputFiles(shortWebm);
  await expect(page.getByRole('status')).toContainText('Vídeo pronto', { timeout: 30_000 });

  await page.getByLabel('Importar arquivo SRT').setInputFiles({
    name: 'legendas.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from('1\n00:00:00,500 --> 00:00:02,000\nLegenda importada\n\n2\n00:00:02,200 --> 00:00:04,000\nSegunda fala\n'),
  });
  await expect(page.getByRole('status')).toContainText('2 blocos importados do SRT');
  await expect(page.getByLabel('Legenda 1 texto')).toHaveValue('Legenda importada');
  await page.getByLabel('Legenda 1 texto').fill('Legenda corrigida');
  await page.getByLabel('Legenda 1 fim').fill('2.1');
  await page.getByRole('radio', { name: 'storytime' }).check();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar SRT' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/tikcut-final-.*\.srt$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = execFileSync('cat', [path!], { encoding: 'utf8' });
  expect(text).toContain('Legenda corrigida');
  expect(text).toContain('00:00:02,100');
});

test('Finalizer navigation remains usable on mobile without horizontal document overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile regression runs only on the mobile project.');
  await page.goto('/');
  await page.getByRole('button', { name: 'FINALIZADOR' }).click();
  await expect(page.getByRole('heading', { name: /FINALIZADOR/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
