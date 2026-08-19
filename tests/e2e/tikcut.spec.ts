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

test('editor handles a 65-minute source, selected-range silence scan and short 9:16 export', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Heavy media QA runs once on desktop Chromium.');
  expect(existsSync(longVideo), `Missing fixture: ${longVideo}`).toBeTruthy();

  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /TikCut/ })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(longVideo);

  const durationValue = page.getByText('Duração', { exact: true }).locator('..').locator('b');
  await expect(durationValue).toHaveText(/^1:05:/, { timeout: 30_000 });
  await expect(page.getByText('1h+ OK', { exact: true })).toBeVisible();
  await expect(page.getByText('OUT 1:00', { exact: true })).toBeVisible();

  const transcript = [
    'Ninguém te conta este segredo sobre frutas de inteligência artificial, mas uma pequena mudança transforma completamente a história.',
    'A melancia percebe que existe uma porta escondida na cozinha e pergunta por que todos os outros personagens têm medo de abri-la?',
    'Quando ela finalmente encosta na maçaneta, uma luz absurda aparece e revela algo que muda tudo para o próximo episódio!'
  ].join(' ');
  await page.locator('.sidebar textarea').fill(transcript);
  await page.getByRole('button', { name: 'Analisar melhores cortes' }).click();
  await expect(page.locator('.suggestion').first()).toBeVisible();
  await page.locator('.suggestion').first().getByRole('button', { name: 'Aplicar IN/OUT sugerido' }).click();
  await expect(page.getByRole('status')).toContainText('Sugestão aplicada');

  // Silence detection is range-scoped. A 14s window proves the selected-range behavior quickly;
  // the dedicated 2:45 test validates the longer cut/export path separately.
  await page.getByLabel('IN segundos').fill('0');
  await page.getByLabel('IN segundos').dispatchEvent('change');
  await page.getByLabel('OUT segundos').fill('14');
  await page.getByLabel('OUT segundos').dispatchEvent('change');
  await expect(page.getByText('OUT 0:14', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Detectar pausas/silêncios' }).click();
  await expect(page.getByRole('status')).toContainText(/pausas detectadas dentro do corte selecionado/, { timeout: 90_000 });
  const silenceStatus = await page.getByRole('status').innerText();
  const silenceCount = Number(silenceStatus.match(/(\d+) pausas/)?.[1] ?? 0);
  expect(silenceCount).toBeGreaterThan(0);

  await setRange(page, 'Início', 120);
  await setRange(page, 'Fim', 122);
  await expect(page.getByText('IN 2:00', { exact: true })).toBeVisible();
  await expect(page.getByText('OUT 2:02', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 4 * 60 * 1000 });
  await page.getByRole('button', { name: 'Exportar MP4 9:16' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  const probe = execFileSync(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path!], { encoding: 'utf8' });
  const exportedDuration = Number(probe.trim());
  expect(exportedDuration).toBeGreaterThan(1.5);
  expect(exportedDuration).toBeLessThan(3.5);
  await expect(page.getByRole('status')).toContainText('Vídeo vertical pronto');
  await expect(page.getByRole('link', { name: 'Baixar vídeo 9:16' })).toBeVisible();

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('local editor settings survive reload and caption modes react', async ({ page }) => {
  await page.goto('/');
  const textarea = page.locator('.sidebar textarea');
  await textarea.fill('Este texto de teste precisa continuar salvo no navegador depois que a página for recarregada completamente.');
  await page.getByRole('button', { name: 'clean' }).click();
  await expect(page.locator('.caption')).toHaveClass(/clean/);
  await page.reload();
  await expect(page.locator('.sidebar textarea')).toHaveValue(/continuar salvo/);
  await expect(page.getByRole('button', { name: 'clean' })).toHaveClass(/active/);
});

test('Storyverse creates continuations, persists them and exports season backup', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'STORYVERSE' }).click();
  await expect(page.getByText('STORYVERSE', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Criar minha primeira série' }).click();
  await expect(page.getByText(/Nova série/).first()).toBeVisible();

  const title = `Série QA ${Date.now()}`;
  await page.getByLabel('Título da série').fill(title);
  await page.getByLabel('Premissa').fill('Uma fruta inteligente descobre um laboratório escondido e precisa entender quem construiu a máquina antes do amanhecer.');
  await page.getByRole('button', { name: 'Episódios' }).click();
  await page.getByRole('button', { name: 'Continuar história' }).click();
  await expect(page.getByText(/EP 01/).first()).toBeVisible();
  await expect(page.getByText(/Cliffhanger/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continuar história' }).click();
  await expect(page.getByText(/EP 02/).first()).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'STORYVERSE' }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Episódios' }).click();
  await expect(page.getByText(/EP 02/).first()).toBeVisible();

  const seasonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar temporada TXT' }).click();
  const season = await seasonDownload;
  expect(season.suggestedFilename()).toMatch(/\.txt$/);
  const seasonPath = await season.path();
  expect(seasonPath).toBeTruthy();
  expect(readFileSync(seasonPath!, 'utf8')).toContain('EP 02');

  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup JSON' }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toMatch(/\.json$/);
  const jsonPath = await json.path();
  expect(jsonPath).toBeTruthy();
  const parsed = JSON.parse(readFileSync(jsonPath!, 'utf8')) as { title: string; episodes: unknown[] };
  expect(parsed.title).toBe(title);
  expect(parsed.episodes.length).toBeGreaterThanOrEqual(2);
});

test('mobile layout exposes Editor, Storyverse and Guide without horizontal crash', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-specific assertion.');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'STORYVERSE', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guia de Uso', exact: true })).toBeVisible();
  const sizes = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 2);
});
