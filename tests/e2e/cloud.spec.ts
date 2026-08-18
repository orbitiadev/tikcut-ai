import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readPublicSupabaseConfig() {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/supabase.ts'), 'utf8');
  const url = source.match(/fallbackUrl\s*=\s*'([^']+)'/)?.[1];
  const key = source.match(/fallbackPublicKey\s*=\s*'([^']+)'/)?.[1];
  if (!url || !key) throw new Error('TikCut public Supabase configuration was not found.');
  return { url, key };
}

test('configured Supabase REST/Auth are reachable and anonymous TikCut data is blocked', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Cloud connectivity is checked once.');
  const { url, key } = readPublicSupabaseConfig();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const apiRoot = await fetch(`${url}/rest/v1/`, { headers });
  expect(apiRoot.status).toBe(200);

  const authSettings = await fetch(`${url}/auth/v1/settings`, { headers });
  expect(authSettings.status).toBe(200);

  const anonymousTableRead = await fetch(`${url}/rest/v1/tikcut_projects?select=id&limit=1`, { headers });
  expect([401, 403]).toContain(anonymousTableRead.status);

  await page.goto('/');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await page.getByRole('button', { name: 'Sincronizar projeto' }).click();
  await expect(page.getByRole('status')).toContainText(/Supabase\/Auth|Magic Link|salvo localmente/);
});
