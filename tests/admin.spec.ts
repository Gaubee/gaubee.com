import { test, expect } from '@playwright/test';

test.describe('Admin Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const githubApiMock = {
        repos: {
          async getContent({ path }: { path: string }) {
            console.log('MOCK getContent called with path:', path);
            if (path === 'src/content') {
              return {
                data: [
                  { name: 'articles', path: 'src/content/articles', type: 'dir' },
                  { name: 'README.md', path: 'src/content/README.md', type: 'file' },
                  { name: 'test.md', path: 'src/content/test.md', type: 'file' },
                ],
              };
            }
            if (path === 'src/content/README.md') {
              return {
                data: {
                  content: Buffer.from('# Hello README').toString('base64'),
                  encoding: 'base64',
                },
              };
            }
             if (path === 'src/content/test.md') {
              return {
                data: {
                  content: Buffer.from('# Original Content').toString('base64'),
                  encoding: 'base64',
                },
              };
            }
            return { data: [] };
          },
        },
        git: {
          async getRef() { return { data: { object: { sha: 'abc' } } }; },
          async getCommit() { return { data: { tree: { sha: 'def' } } }; },
          async createBlob() { return { data: { sha: 'ghi' } }; },
          async createTree() { return { data: { sha: 'jkl' } }; },
          async createCommit() { return { data: { sha: 'mno' } }; },
          async updateRef() { return { data: {} }; },
        }
      };
      // @ts-ignore
      window.__setOctokitInstance(githubApiMock);
    });
  });


  test('should display file browser and load file content', async ({ page }) => {
    await page.goto('/gaubee');

    await expect(page.getByText('articles')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();

    await page.getByText('README.md').click();

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('Hello README');
  });


  test('should stage a new file and show it in the staged list', async ({ page }) => {
    await page.goto('/gaubee');

    page.on('dialog', dialog => dialog.accept('my-new-article.md'));
    await page.getByRole('button', { name: 'New Article' }).click();

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('New article: my-new-article.mdStart writing...');

    await editor.fill('This is the new content.');

    await page.getByRole('button', { name: 'Stage Changes' }).click();

    const stagedChangesList = page.locator('div:has-text("Staged Changes")');
    await expect(stagedChangesList.getByText('articles/my-new-article.md')).toBeVisible();
    await expect(stagedChangesList.getByText('created')).toBeVisible();
  });


  test('should show diff view for an updated file', async ({ page }) => {
    await page.goto('/gaubee');

    await page.getByText('test.md').click();

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.fill('# Updated Content');

    await page.getByRole('button', { name: 'Stage Changes' }).click();

    await page.locator('div:has-text("Staged Changes")').getByText('test.md').click();

    const diffViewer = page.locator('.diff-viewer');
    await expect(diffViewer).toBeVisible();

    await expect(diffViewer.getByText('Original Content')).toBeVisible();
    await expect(diffViewer.getByText('Updated Content')).toBeVisible();

    await page.screenshot({ path: 'jules-scratch/diff-view.png' });
  });


  test('should commit a change successfully', async ({ page }) => {
    await page.goto('/gaubee');

    await page.evaluate(async () => {
      return new Promise<void>(resolve => {
        const request = indexedDB.open('GaubeeAdminDB');
        request.onsuccess = (event: any) => {
          const db = event.target.result;
          const transaction = db.transaction('stagedChanges', 'readwrite');
          const store = transaction.objectStore('stagedChanges');
          store.put({ path: 'test.md', status: 'updated', content: '# test', originalContent: '' });
          transaction.oncomplete = () => resolve();
        };
      });
    });

    await page.reload();

    page.on('dialog', dialog => {
      expect(dialog.message()).toBe('Commit successful!');
      dialog.accept();
    });

    await page.getByPlaceholder('Enter your commit message...').fill('Test commit');
    await page.getByRole('button', { name: 'Commit Changes' }).click();

    await expect(page.getByText('No changes have been staged.')).toBeVisible();
  });
});
