import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const longVideo = resolve(process.cwd(), 'tests/fixtures/long-65min.webm');

test('editor guards actions before a valid video is loaded', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Detectar pausas/silêncios' }).click();
  await expect(page.getByRole('status')).toContainText('Importe um vídeo primeiro');
  await expect(page.getByRole('button', { name: 'Exportar MP4 9:16' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cortar vídeo' })).toBeDisabled();
});

test('editor rejects non-video files without crashing', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'nao-e-video.txt', mimeType: 'text/plain', buffer: Buffer.from('arquivo invalido para o editor'),
  });
  await expect(page.getByRole('status')).toContainText('Selecione um arquivo de vídeo válido');
  await expect(page.getByRole('button', { name: 'Cortar vídeo' })).toBeDisabled();
});

test('long source prevents accidental cut longer than ten minutes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Long media edge case runs once.');
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(longVideo);
  await expect(page.getByText('1h+ OK', { exact: true })).toBeVisible({ timeout: 30_000 });
  const end = page.locator('input[aria-label="Fim"]');
  await end.evaluate((element: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, '601');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Cortar vídeo' }).click();
  await expect(page.getByRole('status')).toContainText('até 10 minutos por corte');
});

test('caption styles and transcript scoring remain interactive', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar textarea').fill('Você precisa ver isto agora! Uma fruta encontra uma passagem secreta e pergunta o que existe do outro lado? No final, uma revelação muda completamente a história!');
  for (const style of ['impact', 'clean', 'karaoke']) {
    await page.getByRole('button', { name: style, exact: true }).click();
    await expect(page.locator('.caption')).toHaveClass(new RegExp(style));
  }
  await page.getByRole('button', { name: 'Analisar melhores cortes' }).click();
  await expect(page.locator('.suggestion').first()).toBeVisible();
  await expect(page.locator('.suggestion').first().locator('.score')).toContainText('/100');
});

test('navigation switches between editor, Storyverse and guide', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'STORYVERSE', exact: true }).click();
  await expect(page.getByText('STORYVERSE', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Guia de Uso', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Como usar o TikCut AI/ })).toBeVisible();
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(page.getByText('3 · AutoCut por texto', { exact: true })).toBeVisible();
});
