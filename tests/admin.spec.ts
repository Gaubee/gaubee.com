import { test, expect } from '@playwright/test';

test.describe('Admin Panel', () => {
  test('should display file browser with mocked files', async ({ page }) => {
    // Mock the GitHub API call to get repository contents
    await page.route('https://api.github.com/repos/gaubee/gaubee.com/contents/', async (route) => {
      const json = [
        { name: 'articles', path: 'articles', type: 'dir' },
        { name: 'events', path: 'events', type: 'dir' },
        { name: 'README.md', path: 'README.md', type: 'file' },
      ];
      await route.fulfill({ json });
    });

    // Navigate to the admin page
    await page.goto('/gaubee');

    // Check if the file browser displays the mocked files
    await expect(page.getByText('articles')).toBeVisible();
    await expect(page.getByText('events')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();

    // Check for the folder and file icons
    await expect(page.getByText('📁')).toHaveCount(2);
    await expect(page.getByText('📄')).toHaveCount(1);
  });

  test('should load file content into editor on click', async ({ page }) => {
    // Mock file list
    await page.route('https://api.github.com/repos/gaubee/gaubee.com/contents/', async (route) => {
      await route.fulfill({ json: [{ name: 'test.md', path: 'test.md', type: 'file' }] });
    });

    // Mock file content
    const fileContent = '# Hello World';
    await page.route('https://api.github.com/repos/gaubee/gaubee.com/contents/test.md', async (route) => {
      await route.fulfill({
        json: {
          content: Buffer.from(fileContent).toString('base64'),
          encoding: 'base64',
        },
      });
    });

    await page.goto('/gaubee');

    // Click the file
    await page.getByText('test.md').click();

    // Check if the editor is visible and contains the content
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('Hello World');
  });

  test('should stage a change to IndexedDB on save', async ({ page }) => {
    // Mock APIs
    await page.route('**/repos/gaubee/gaubee.com/contents/', async r => r.fulfill({ json: [] }));
    await page.route('**/repos/gaubee/gaubee.com/contents/new-file.md', async r => r.fulfill({ json: {} }));

    await page.goto('/gaubee');

    // Create a new file
    page.on('dialog', dialog => dialog.accept('new-file.md'));
    await page.getByRole('button', { name: 'New Article' }).click();

    // Edit the content
    const editor = page.locator('.ProseMirror');
    await editor.fill('This is the new content.');

    // Click save
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Check Staged Changes list UI
    await expect(page.locator('div:has-text("Staged Changes")').getByText('new-file.md')).toBeVisible();
    await expect(page.locator('div:has-text("Staged Changes")').getByText('CREATED')).toBeVisible();

    // Verify IndexedDB content
    const stagedChanges = await page.evaluate(async () => {
      return new Promise(resolve => {
        const request = indexedDB.open('GaubeeAdminDB');
        request.onsuccess = (event) => {
          const db = event.target.result;
          const transaction = db.transaction('stagedChanges', 'readonly');
          const store = transaction.objectStore('stagedChanges');
          const getAllRequest = store.getAll();
          getAllRequest.onsuccess = () => resolve(getAllRequest.result);
        };
      });
    });

    expect(stagedChanges).toHaveLength(1);
    expect(stagedChanges[0].path).toBe('src/content/articles/new-file.md');
    expect(stagedChanges[0].status).toBe('created');
  });

  test('should send correct requests on commit', async ({ page }) => {
    // Mock getRef
    await page.route('**/git/ref/heads/main', async r => r.fulfill({ json: { object: { sha: 'abc' } } }));
    // Mock getCommit
    await page.route('**/git/commits/abc', async r => r.fulfill({ json: { tree: { sha: 'def' } } }));
    // Mock createBlob
    await page.route('**/git/blobs', async r => r.fulfill({ json: { sha: 'ghi' } }));
    // Mock createTree
    await page.route('**/git/trees', async r => r.fulfill({ json: { sha: 'jkl' } }));
    // Mock createCommit
    await page.route('**/git/commits', async r => r.fulfill({ json: { sha: 'mno' } }));
    // Mock updateRef
    await page.route('**/git/refs/heads/main', async r => r.fulfill({ json: {} }));

    await page.goto('/gaubee');

    // Create a change to be committed
    await page.evaluate(async () => {
      return new Promise<void>(resolve => {
        const request = indexedDB.open('GaubeeAdminDB');
        request.onsuccess = (event) => {
          const db = event.target.result;
          const transaction = db.transaction('stagedChanges', 'readwrite');
          const store = transaction.objectStore('stagedChanges');
          store.put({ path: 'test.md', status: 'updated', content: '# test' });
          transaction.oncomplete = () => resolve();
        };
      });
    });

    // Reload the page to see the staged change
    await page.reload();

    // Fill commit message and click commit
    await page.getByPlaceholder('Enter your commit message...').fill('Test commit');
    await page.getByRole('button', { name: 'Commit Changes' }).click();

    // Expect the success alert
    page.on('dialog', dialog => {
      expect(dialog.message()).toBe('Commit successful!');
      dialog.accept();
    });

    // The UI should now show no staged changes
    await expect(page.getByText('No changes have been staged.')).toBeVisible();
  });
});
