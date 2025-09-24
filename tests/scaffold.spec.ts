import { test, expect } from '@playwright/test';

test.describe('Scaffold Component', () => {
  test('should display mobile layout on small screens', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Navigate to scaffold demo page
    await page.goto('/scaffold-demo');
    
    // Wait for the page to load
    await page.waitForTimeout(1000);
    
    // Check that bottom bar is visible on mobile
    const bottomBar = page.locator('footer:has(button)');
    await expect(bottomBar).toBeVisible();
    
    // Check that navigation rail is not visible on mobile
    const navRail = page.locator('aside:has(nav)');
    await expect(navRail).not.toBeVisible();
    
    // Take screenshot of mobile layout
    await page.screenshot({ path: 'tests/screenshots/scaffold-mobile.png' });
  });

  test('should display tablet layout on medium screens', async ({ page }) => {
    // Set viewport to tablet size
    await page.setViewportSize({ width: 768, height: 1024 });
    
    // Navigate to scaffold demo page
    await page.goto('/scaffold-demo');
    
    // Wait for the page to load
    await page.waitForTimeout(1000);
    
    // Check that navigation rail is visible on tablet
    const navRail = page.locator('aside:has(nav)');
    await expect(navRail).toBeVisible();
    
    // Check that bottom bar is not visible on tablet
    const bottomBar = page.locator('footer:has(button)');
    await expect(bottomBar).not.toBeVisible();
    
    // Take screenshot of tablet layout
    await page.screenshot({ path: 'tests/screenshots/scaffold-tablet.png' });
  });

  test('should display desktop layout on large screens', async ({ page }) => {
    // Set viewport to desktop size
    await page.setViewportSize({ width: 1280, height: 800 });
    
    // Navigate to scaffold demo page
    await page.goto('/scaffold-demo');
    
    // Wait for the page to load
    await page.waitForTimeout(1000);
    
    // Check that navigation rail is visible on desktop
    const navRail = page.locator('aside:has(nav)');
    await expect(navRail).toBeVisible();
    
    // Check that bottom bar is not visible on desktop
    const bottomBar = page.locator('footer:has(button)');
    await expect(bottomBar).not.toBeVisible();
    
    // Take screenshot of desktop layout
    await page.screenshot({ path: 'tests/screenshots/scaffold-desktop.png' });
  });

  test('should toggle drawer on mobile', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Navigate to scaffold demo page
    await page.goto('/scaffold-demo');
    
    // Wait for the page to load
    await page.waitForTimeout(1000);
    
    // Check that drawer is initially closed
    const drawer = page.locator('[role="dialog"]').first();
    await expect(drawer).not.toBeVisible();
    
    // Click menu button to open drawer
    await page.locator('button[aria-label="Open menu"]').first().click();
    
    // Wait for drawer to open
    await page.waitForTimeout(500);
    
    // Check that drawer is now visible
    await expect(drawer).toBeVisible();
    
    // Take screenshot of open drawer
    await page.screenshot({ path: 'tests/screenshots/scaffold-drawer-open.png' });
  });
});