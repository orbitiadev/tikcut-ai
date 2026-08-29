import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const longVideo = resolve(process.cwd(), 'tests/fixtures/long-125min-h264.mp4');

test('2h05 source automatically creates many cuts and can render one without manual minute selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-desktop', 'H.264 long-form proof runs once in branded Chrome.');
  expect(existsSync(longVideo), `Missing fixture: ${longVideo}`).toBeTruthy();

  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(longVideo);

  const durationValue = page.getByText('Duração', { exact: true }).locator('..').locator('b');
  await expect(durationValue).toHaveText(/^2:05:/, { timeout: 30_000 });
  await expect(page.getByText('2h+ OK', { exact: true })).toBeVisible();

  const queue = page.getByTestId('cut-queue');
  await expect(queue.locator('.cut-card').first()).toBeVisible();
  expect(await queue.locator('.cut-card').count()).toBeGreaterThanOrEqual(15);
  await expect(page.getByRole('button', { name: /Cortar \d+ selecionados/ })).toBeEnabled();

  await page.getByLabel('Quantidade de cortes').fill('20');
  await page.getByRole('button', { name: 'Gerar cortes automáticos', exact: true }).click();
  await expect(queue.locator('.cut-card')).toHaveCount(20);

  const first = queue.locator('.cut-card').first();
  const last = queue.locator('.cut-card').last();
  await expect(first).toContainText(/0:/);
  await expect(last).toContainText(/1:|2:/);

  await first.getByRole('button', { name: 'Cortar agora', exact: true }).click();
  await expect(first.getByRole('button', { name: /Baixar/ })).toBeVisible({ timeout: 4 * 60 * 1000 });
  await expect(page.getByRole('status')).toContainText(/pronto/i);

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
