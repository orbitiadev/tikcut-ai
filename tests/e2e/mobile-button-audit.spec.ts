import { expect, test, type Page } from '@playwright/test';

type ButtonDescriptor = { text: string; occurrence: number };

const AREAS = ['Editor', 'STUDIO PRO', 'FINALIZADOR', 'STORYVERSE', 'Guia de Uso'] as const;
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 360, height: 800 },
  { width: 412, height: 915 },
];

async function openArea(page: Page, area: (typeof AREAS)[number]) {
  await page.goto('/');
  await page.getByRole('button', { name: area, exact: true }).click();
  await page.waitForTimeout(80);
}

async function visibleEnabledButtons(page: Page): Promise<ButtonDescriptor[]> {
  const raw = await page.locator('button').evaluateAll((buttons) => buttons
    .filter((button) => {
      const element = button as HTMLButtonElement;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })
    .map((button) => ((button.textContent || button.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')))
    .filter(Boolean));

  const seen = new Map<string, number>();
  return raw.map((text) => {
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    return { text, occurrence };
  });
}

function fingerprint(page: Page) {
  return page.evaluate(() => ({
    text: document.body.innerText,
    htmlClass: document.documentElement.className,
    bodyClass: document.body.className,
    active: Array.from(document.querySelectorAll('button.active, [aria-pressed="true"], [aria-selected="true"]'))
      .map((node) => (node.textContent || '').trim()).join('|'),
  }));
}

test('mobile navigation stays usable at compact Android widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only audit.');

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    for (const area of AREAS) {
      const nav = page.getByRole('button', { name: area, exact: true });
      await expect(nav).toBeVisible();
      await nav.click();
      await expect(nav).toHaveClass(/active/);
      const sizes = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(sizes.scrollWidth, `${area} overflow at ${viewport.width}px`).toBeLessThanOrEqual(sizes.clientWidth + 2);
    }
  }
});

test('every initially enabled mobile button can be pressed without crash and dead controls are reported', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile-only audit.');
  await page.setViewportSize({ width: 360, height: 800 });

  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on('dialog', (dialog) => void dialog.dismiss());

  const noOps: string[] = [];
  const audited: string[] = [];

  for (const area of AREAS) {
    await openArea(page, area);
    const descriptors = await visibleEnabledButtons(page);

    for (const descriptor of descriptors) {
      // Clicking the already-active area is intentionally a no-op; native form validation on Entrar
      // is also handled by the browser when the required e-mail field is empty.
      if (descriptor.text === area || descriptor.text === 'Entrar') continue;

      await openArea(page, area);
      const matches = page.locator('button').filter({ hasText: descriptor.text });
      const button = matches.nth(descriptor.occurrence);
      if (!(await button.isVisible().catch(() => false)) || await button.isDisabled().catch(() => true)) continue;

      const intentionallySelected = await button.evaluate((element) => {
        const value = element as HTMLButtonElement;
        return value.classList.contains('active') || value.getAttribute('aria-pressed') === 'true' || value.getAttribute('aria-selected') === 'true';
      }).catch(() => false);
      if (intentionallySelected) continue;

      const before = await fingerprint(page);
      const beforeUrl = page.url();
      let downloadStarted = false;
      const onDownload = () => { downloadStarted = true; };
      page.once('download', onDownload);

      try {
        await button.click({ timeout: 5_000 });
        await page.waitForTimeout(180);
      } catch (error) {
        runtimeErrors.push(`${area} → ${descriptor.text}: click failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      const after = await fingerprint(page).catch(() => before);
      const changed = downloadStarted || page.url() !== beforeUrl || JSON.stringify(before) !== JSON.stringify(after);
      if (!changed) noOps.push(`${area} → ${descriptor.text}`);
      audited.push(`${area} → ${descriptor.text}`);
    }
  }

  console.log(`MOBILE_BUTTON_AUDIT audited=${audited.length}`);
  console.log(`MOBILE_BUTTON_AUDIT buttons=${JSON.stringify(audited)}`);
  console.log(`MOBILE_BUTTON_AUDIT noops=${JSON.stringify(noOps)}`);

  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);

  // A visible enabled button that produces no UI state, navigation, dialog/download or feedback is
  // suspicious on mobile. Already-selected buttons are intentionally skipped above.
  expect(noOps, `Enabled buttons with no observable response:\n${noOps.join('\n')}`).toEqual([]);
});