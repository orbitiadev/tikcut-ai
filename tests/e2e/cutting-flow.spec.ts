// Final regression coverage for the real cutting flow.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const longWebm = resolve(process.cwd(), 'tests/fixtures/long-65min.webm');
const longMp4 = resolve(process.cwd(), 'tests/fixtures/long-65min-h264.mp4');

async function setSeconds(page: import('@playwright/test').Page, label: string, value: number) {
  const input = page.getByLabel(label);
  await input.fill(String(value));
  await input.dispatchEvent('change');
}

function probeDuration(path: string) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path], { encoding: 'utf8' }).trim());
}

test('new cut button creates a real downloadable result from a 65-minute WebM source', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Heavy FFmpeg fallback QA runs once.');
  expect(existsSync(longWebm)).toBeTruthy();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText('1h+ OK', { exact: true })).toBeVisible();

  await setSeconds(page, 'IN segundos', 120);
  await setSeconds(page, 'OUT segundos', 123);
  await expect(page.getByText('IN 2:00', { exact: true })).toBeVisible();
  await expect(page.getByText('OUT 2:03', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 4 * 60 * 1000 });
  await page.getByRole('button', { name: 'Cortar vídeo', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(download.suggestedFilename()).toMatch(/tikcut-corte-.*\.mp4$/);
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  const duration = probeDuration(path!);
  expect(duration).toBeGreaterThan(2.4);
  expect(duration).toBeLessThan(3.7);

  await expect(page.getByLabel('Resultado do corte')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Baixar corte pronto' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Corte pronto');
});

test('common H.264/AAC MP4 can be cut from a 65-minute source in Chrome', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop', 'H.264 browser compatibility is validated in branded Chrome.');
  expect(existsSync(longMp4)).toBeTruthy();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(longMp4);
  const durationValue = page.getByText('Duração', { exact: true }).locator('..').locator('b');
  await expect(durationValue).toHaveText(/^1:05:/, { timeout: 30_000 });

  await setSeconds(page, 'IN segundos', 300);
  await setSeconds(page, 'OUT segundos', 304);
  await expect(page.getByText('IN 5:00', { exact: true })).toBeVisible();
  await expect(page.getByText('OUT 5:04', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download', { timeout: 4 * 60 * 1000 });
  await page.getByRole('button', { name: 'Cortar vídeo', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  const duration = probeDuration(path!);
  expect(duration).toBeGreaterThan(3.2);
  expect(duration).toBeLessThan(5.5);
  await expect(page.getByRole('link', { name: 'Baixar corte pronto' })).toBeVisible();
});

test('2:30 and 2:45 presets create the requested long short-form range and a real 2:45 MP4', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop', 'Long H.264 preset export is validated once in branded Chrome.');
  expect(existsSync(longMp4)).toBeTruthy();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(longMp4);
  await expect(page.getByText('1h+ OK', { exact: true })).toBeVisible({ timeout: 30_000 });
  await setSeconds(page, 'IN segundos', 300);

  await page.getByRole('button', { name: '2:30', exact: true }).click();
  await expect(page.getByText('OUT 7:30', { exact: true })).toBeVisible();
  await expect(page.getByText('2:30', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '2:45', exact: true }).click();
  await expect(page.getByText('OUT 7:45', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 5 * 60 * 1000 });
  await page.getByRole('button', { name: 'Cortar vídeo', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(statSync(path!).size).toBeGreaterThan(100_000);
  const duration = probeDuration(path!);
  expect(duration).toBeGreaterThan(163.5);
  expect(duration).toBeLessThan(166.8);
  await expect(page.getByRole('status')).toContainText('Corte pronto');
});

test('guide explains only functions that exist in the current app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Guia de Uso' }).click();
  await expect(page.getByRole('heading', { name: /Como usar o TikCut AI/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Cortar e baixar/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Limites atuais que o TikCut mostra sem fingir/ })).toBeVisible();
});
