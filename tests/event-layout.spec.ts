import { test, expect } from '@playwright/test';

test('event detail page has two-column layout', async ({ page }) => {
  // Navigate to a specific event page
  await page.goto('/events/00002.event-2');

  // Wait for the page to be fully loaded
  await page.waitForLoadState('networkidle');

  // Check for the presence of the right sidebar
  const rightSidebar = page.locator('.right-sidebar');
  await expect(rightSidebar).toBeVisible();

  // Check that the prev/next navigation is visible within the sidebar
  const prevNextNav = rightSidebar.locator('text=导航');
  await expect(prevNextNav).toBeVisible();

  const nextLink = rightSidebar.locator('text=下一篇');
  await expect(nextLink).toBeVisible();

  // Take a screenshot to visually verify the layout
  await page.screenshot({ path: 'tests/screenshots/event-layout.png', fullPage: true });
});
