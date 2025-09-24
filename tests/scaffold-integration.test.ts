import { test, expect } from '@playwright/test';

test.describe('Scaffold Integration', () => {
  test('should render homepage with scaffold components', async ({ page }) => {
    // Navigate to the homepage
    await page.goto('http://localhost:4322');
    
    // Check that the page title is correct
    await expect(page).toHaveTitle(/Gaubee's Blog/);
    
    // Check that AppBar is visible
    const appBar = page.locator('header:has-text("Gaubee\'s Blog")');
    await expect(appBar).toBeVisible();
    
    // Check that main content is visible
    const mainContent = page.locator('main:has-text("Gaubee\'s Feed")');
    await expect(mainContent).toBeVisible();
    
    // Take screenshot of the homepage
    await page.screenshot({ path: 'tests/screenshots/homepage-scaffold.png' });
  });

  test('should show responsive behavior on mobile', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Navigate to the homepage
    await page.goto('http://localhost:4322');
    
    // Check that bottom bar is visible on mobile
    const bottomBar = page.locator('footer:has-text("首页")');
    await expect(bottomBar).toBeVisible();
    
    // Check that navigation rail is not visible on mobile
    const navRail = page.locator('aside:has-text("首页")').first();
    await expect(navRail).not.toBeVisible();
    
    // Take screenshot of mobile view
    await page.screenshot({ path: 'tests/screenshots/mobile-scaffold.png' });
  });

  test('should show responsive behavior on desktop', async ({ page }) => {
    // Set viewport to desktop size
    await page.setViewportSize({ width: 1280, height: 800 });
    
    // Navigate to the homepage
    await page.goto('http://localhost:4322');
    
    // Check that navigation rail is visible on desktop
    const navRail = page.locator('aside:has-text("首页")').first();
    await expect(navRail).toBeVisible();
    
    // Check that bottom bar is not visible on desktop
    const bottomBar = page.locator('footer:has-text("首页")');
    await expect(bottomBar).not.toBeVisible();
    
    // Take screenshot of desktop view
    await page.screenshot({ path: 'tests/screenshots/desktop-scaffold.png' });
  });
});