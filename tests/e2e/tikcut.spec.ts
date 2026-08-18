import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const longVideo = resolve(process.cwd(), 'tests/fixtures/long-65min.webm');
const ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe';

async function setRange(page: Page, label: string, value: number) {
  const locator = page.locator(`input[aria-label="${label}"]`);
  await locator.evaluate((element: HTMLInputElement, next: number) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('editor handles a 65-minute source, silence scan and vertical MP4 export', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Heavy media QA runs once on desktop Chromium.');
  expect(existsSync(longVideo)).toBeTruthy();

  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(longVideo);
  await expect(page.getByText('Duração', { exact: true }).locator('..').locator('b')).toHaveText(/^1:05:/, { timeout: 30_000 });
  await expect(page.getByText('1h+ OK', { exact: true })).toBeVisible();
  await expect(page.getByText('OUT 1:00', { exact: true })).toBeVisible();

  await page.locator('.sidebar textarea').fill('Ninguém te conta este segredo sobre frutas de inteligência artificial! A melancia encontra uma porta escondida e pergunta o que existe do outro lado? No final, uma revelação muda tudo!');
  await page.getByRole('button', { name: 'Analisar melhores cortes' }).click();
  await expect(page.locator('.suggestion').first()).toBeVisible();
  await page.locator('.suggestion').first().getByRole('button', { name: /Aplicar IN\/OUT sugerido/ }).click();
  await expect(page.getByRole('status')).toContainText('Sugestão aplicada');

  await page.getByRole('button', { name: 'Detectar pausas/silêncios' }).click();
  await expect(page.getByRole('status')).toContainText(/pausas longas detectadas/, { timeout: 4 * 60 * 1000 });

  await setRange(page, 'Início', 120);
  await setRange(page, 'Fim', 122);
  await expect(page.getByText('IN 2:00', { exact: true })).toBeVisible();
  await expect(page.getByText('OUT 2:02', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 4 * 60 * 1000 });
  await page.getByRole('button', { name: 'Exportar MP4 9:16' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  const duration = Number(execFileSync(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path!], { encoding: 'utf8' }).trim());
  expect(duration).toBeGreaterThan(1.5);
  expect(duration).toBeLessThan(3.5);
  await expect(page.getByRole('status')).toContainText('Vídeo vertical pronto');
  await expect(page.getByLabel('Resultado do corte')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('local editor settings survive reload and caption modes react', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar textarea').fill('Este texto precisa continuar salvo depois que a página for recarregada completamente.');
  await page.getByRole('button', { name: 'clean', exact: true }).click();
  await expect(page.locator('.caption')).toHaveClass(/clean/);
  await page.reload();
  await expect(page.locator('.sidebar textarea')).toHaveValue(/continuar salvo/);
  await expect(page.getByRole('button', { name: 'clean', exact: true })).toHaveClass(/active/);
});

test('Storyverse creates continuations, persists them and exports season backup', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'STORYVERSE', exact: true }).click();
  await page.getByRole('button', { name: 'Criar minha primeira série' }).click();
  await page.locator('.story-tabs').getByRole('button', { name: 'Série', exact: true }).click();
  await page.getByLabel('Título').fill('Frutas do Portal');
  await page.getByLabel('Premissa').fill('Uma melancia curiosa encontra um portal escondido na cozinha.');
  await page.getByLabel('Tom').fill('misterioso e divertido');
  await page.getByLabel('Estilo visual').fill('frutas antropomórficas cinematográficas, vertical 9:16');
  await page.locator('.story-tabs').getByRole('button', { name: 'Personagens', exact: true }).click();
  await page.getByRole('button', { name: '+ Personagem' }).click();
  await page.locator('.character-name').fill('Mela');
  await page.getByLabel('Aparência').fill('melancia pequena, olhos grandes, mochila vermelha');
  await page.getByLabel('Personalidade').fill('curiosa e corajosa');
  await page.locator('.story-tabs').getByRole('button', { name: 'Episódios', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar história' }).click();
  await expect(page.getByText('EP 01', { exact: true }).first()).toBeVisible();
  await page.locator('.story-tabs').getByRole('button', { name: 'Episódios', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar história' }).click();
  await expect(page.getByText('EP 02', { exact: true }).first()).toBeVisible();

  const txtPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar temporada TXT' }).click();
  const txtPath = await (await txtPromise).path();
  const season = readFileSync(txtPath!, 'utf8');
  expect(season).toContain('EP 01');
  expect(season).toContain('EP 02');

  const jsonPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup JSON' }).click();
  const jsonPath = await (await jsonPromise).path();
  const backup = JSON.parse(readFileSync(jsonPath!, 'utf8')) as { episodes: unknown[]; characters: unknown[] };
  expect(backup.episodes).toHaveLength(2);
  expect(backup.characters).toHaveLength(1);

  await page.reload();
  await page.getByRole('button', { name: 'STORYVERSE', exact: true }).click();
  await expect(page.getByText('Frutas do Portal', { exact: true }).first()).toBeVisible();
});

test('mobile layout exposes Editor, Storyverse and Guide without horizontal crash', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only layout check.');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'STORYVERSE', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guia de Uso', exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 2);
});
