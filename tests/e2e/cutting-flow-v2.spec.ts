import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const longWebm = resolve(process.cwd(), 'tests/fixtures/long-65min.webm');
const ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe';

async function setSeconds(page: import('@playwright/test').Page, label: string, value: number) {
  const input = page.getByLabel(label);
  await input.fill(String(value));
  await input.dispatchEvent('change');
}

test('Cortar vídeo creates a real downloadable MP4 from a 65-minute source', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Heavy cut QA runs once.');
  expect(existsSync(longWebm)).toBeTruthy();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(longWebm);
  await expect(page.getByText('1h+ OK', { exact: true })).toBeVisible({ timeout: 30_000 });

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

  const probe = execFileSync(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path!], { encoding: 'utf8' });
  const duration = Number(probe.trim());
  expect(duration).toBeGreaterThan(2.2);
  expect(duration).toBeLessThan(4.5);

  await expect(page.getByLabel('Resultado do corte')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Baixar corte pronto' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Corte pronto');
});

test('Guide documents the real editor workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Guia de Uso', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Como usar o TikCut AI/ })).toBeVisible();
  await expect(page.getByText('Cortar o vídeo', { exact: true })).toBeVisible();
});
