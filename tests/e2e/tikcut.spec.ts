import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const longVideo = resolve(process.cwd(), 'tests/fixtures/long-65min.webm');

async function setRange(page: Page, label: string, value: number) {
  const locator = page.locator(`input[aria-label="${label}"]`);
  await locator.evaluate((element: HTMLInputElement, next: number) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('editor handles a 65-minute source, silence scan and short MP4 export', async ({ page }, testInfo) => {
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
  await page.locator('.suggestion').first().getByRole('button', { name: 'Aplicar corte estimado' }).click();
  await expect(page.getByRole('status')).toContainText('Sugestão aplicada');

  await page.getByRole('button', { name: 'Detectar silêncios' }).click();
  await expect(page.getByRole('status')).toContainText(/pausas longas detectadas/, { timeout: 4 * 60 * 1000 });
  const silenceStatus = await page.getByRole('status').innerText();
  const silenceCount = Number(silenceStatus.match(/(\d+) pausas/)?.[1] ?? 0);
  expect(silenceCount).toBeGreaterThan(10);

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
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', path!], { encoding: 'utf8' });
  const exportedDuration = Number(probe.trim());
  expect(exportedDuration).toBeGreaterThan(1.5);
  expect(exportedDuration).toBeLessThan(3.5);
  await expect(page.getByRole('status')).toContainText('MP4 9:16 exportado');

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

  await page.locator('.story-tabs').getByRole('button', { name: 'Série', exact: true }).click();
  await page.getByLabel('Título').fill('Frutas do Portal');
  await page.getByLabel('Premissa').fill('Uma melancia curiosa encontra um portal escondido na cozinha e precisa descobrir por que as frutas adultas escondem a verdade.');
  await page.getByLabel('Tom').fill('misterioso e divertido');
  await page.getByLabel('Estilo visual').fill('frutas antropomórficas cinematográficas, vertical 9:16');

  await page.locator('.story-tabs').getByRole('button', { name: 'Personagens', exact: true }).click();
  await page.getByRole('button', { name: '+ Personagem' }).click();
  await page.locator('.character-name').fill('Mela');
  await page.getByLabel('Aparência').fill('melancia pequena, casca verde escura, olhos grandes, mochila vermelha');
  await page.getByLabel('Personalidade').fill('curiosa, corajosa e impulsiva');

  await page.locator('.story-tabs').getByRole('button', { name: 'Episódios', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar história' }).click();
  await expect(page.locator('.storyboard-panel')).toBeVisible();
  await expect(page.getByText('EP 01', { exact: true }).first()).toBeVisible();

  await page.locator('.story-tabs').getByRole('button', { name: 'Episódios', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar história' }).click();
  await expect(page.getByText('EP 02', { exact: true }).first()).toBeVisible();

  const pngPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Capa PNG' }).click();
  const png = await pngPromise;
  const pngPath = await png.path();
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  expect(statSync(pngPath!).size).toBeGreaterThan(10_000);

  const txtPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar temporada TXT' }).click();
  const txt = await txtPromise;
  const txtPath = await txt.path();
  const season = readFileSync(txtPath!, 'utf8');
  expect(season).toContain('EP 01');
  expect(season).toContain('EP 02');

  const jsonPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup JSON' }).click();
  const json = await jsonPromise;
  const jsonPath = await json.path();
  const backup = JSON.parse(readFileSync(jsonPath!, 'utf8')) as { episodes: unknown[]; characters: unknown[] };
  expect(backup.episodes).toHaveLength(2);
  expect(backup.characters).toHaveLength(1);

  await page.reload();
  await page.getByRole('button', { name: 'STORYVERSE' }).click();
  await expect(page.getByText('Frutas do Portal', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('2 episódios', { exact: false }).first()).toBeVisible();
});

test('mobile layout exposes both Editor and Storyverse without horizontal crash', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only layout check.');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'STORYVERSE', exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 2);
  await page.getByRole('button', { name: 'STORYVERSE', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Criar minha primeira série' })).toBeVisible();
});
