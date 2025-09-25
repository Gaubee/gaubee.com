import { expect, test, type Page } from "@playwright/test";

// This beforeEach hook sets up a mock of the GitHub API for all tests in this file.
test.beforeEach(async ({ page }) => {
  page.on("console", (msg) => {
    console.log(`Browser Console [${msg.type()}]: ${msg.text()}`);
  });
  page.on("pageerror", (error) => {
    console.log(`Browser PageError: ${error.stack ?? error.message}`);
  });
  // By using addInitScript, this mock will be in place before any of the page's
  // JavaScript runs. This is crucial for ensuring our components use the mock.
  await page.addInitScript(() => {
    // This is a browser-side mock of the Octokit instance.
    const githubApiMock = {
      repos: {
        async getContent({ path }: { path: string }) {
          if (path === "src/content") {
            return {
              data: [
                { name: "articles", path: "src/content/articles", type: "dir" },
                {
                  name: "README.md",
                  path: "src/content/README.md",
                  type: "file",
                },
                { name: "test.md", path: "src/content/test.md", type: "file" },
              ],
            };
          }
          if (path === "src/content/README.md") {
            return {
              data: {
                type: "file",
                content: btoa("# Hello README"),
                encoding: "base64",
              },
            };
          }
          if (path === "src/content/test.md") {
            return {
              data: {
                type: "file",
                content: btoa("# Original Content"),
                encoding: "base64",
              },
            };
          }
          return { data: [] };
        },
      },
      git: {
        async getRef() {
          return { data: { object: { sha: "abc" } } };
        },
        async getCommit() {
          return { data: { tree: { sha: "def" } } };
        },
        async createBlob() {
          return { data: { sha: "ghi" } };
        },
        async createTree() {
          return { data: { sha: "jkl" } };
        },
        async createCommit() {
          return { data: { sha: "mno" } };
        },
        async updateRef() {
          return { data: {} };
        },
      },
      users: {
        async getAuthenticated() {
          console.log("MOCK getAuthenticated");
          return { data: { login: "test-user" } };
        },
      },
    };
    Object.assign(globalThis, {
      __injectedOctokitInstance: githubApiMock,
    });
  });
});

test.describe("Admin Panel", () => {
  const login = async (page: Page) => {
    await page.goto("/admin/login");
    await page.getByPlaceholder("ghp_...").pressSequentially("test-token");
    await page.getByRole("button", { name: "Save and Continue" }).click();
    await page.waitForURL("**/admin");
  };

  test("should login successfully and see file browser", async ({ page }) => {
    await login(page);

    await expect(page.getByText("File Management")).toBeVisible();
    await expect(page.getByText("articles")).toBeVisible();
    await expect(page.getByText("README.md")).toBeVisible();
  });

  test("should navigate to editor, edit, and stage a change", async ({
    page,
  }) => {
    await login(page);

    await page.getByText("test.md").click();
    await page.waitForURL("**/admin/editor?path=src/content/test.md");

    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await editor.fill("# Updated Content");

    await page.getByRole("button", { name: "Stage Changes" }).click();
    await page.waitForURL("**/admin");

    const stagedChangesList = page.getByRole("region", {
      name: "Staged Changes Panel",
    });
    await expect(stagedChangesList.getByText("test.md")).toBeVisible();
    await expect(stagedChangesList.getByText("updated")).toBeVisible();
  });

  test("should show diff view for an updated file", async ({ page }) => {
    await login(page);

    await page.getByText("test.md").click();
    await page.waitForURL("**/admin/editor?path=src/content/test.md");

    await page.locator(".ProseMirror").fill("# Updated Content");
    await page.getByRole("button", { name: "Stage Changes" }).click();
    await page.waitForURL("**/admin");

    await page
      .getByRole("region", { name: "Staged Changes Panel" })
      .getByText("test.md")
      .click();

    const diffViewer = page.locator(".diff-viewer");
    await expect(diffViewer).toBeVisible();
    await expect(diffViewer.getByText("Original Content")).toBeVisible();
    await expect(diffViewer.getByText("Updated Content")).toBeVisible();
  });

  test("should commit a change successfully", async ({ page }) => {
    await login(page);
    await page.reload();
    await page.waitForURL("**/admin");

    /// 因为indexeddb的open具有互斥问题，所以必须用init-script来执行
    page.addInitScript(() => {
      Object.assign(globalThis, {
        __db_inject: new Promise<void>((resolve) => {
          if (localStorage.getItem("InjectGaubeeAdminDB") === "done") {
            resolve();
            return;
          }
          const request = indexedDB.open("GaubeeAdminDB");
          request.onsuccess = (event: any) => {
            const db = event.target.result;
            const transaction = db.transaction("stagedChanges", "readwrite");
            const store = transaction.objectStore("stagedChanges");
            store.put({
              path: "test.md",
              status: "updated",
              content: "# test",
              originalContent: "",
            });
            transaction.oncomplete = () => {
              localStorage.setItem("InjectGaubeeAdminDB", "done");
              resolve();
            };
          };
        }),
      });
    });
    await page.reload();
    await page.evaluate(async () => {
      return Reflect.get(globalThis, "__db_inject");
    });

    await page.reload();
    await page.waitForURL("**/admin");

    const dialogPromise = page.waitForEvent("dialog");
    await page
      .getByPlaceholder("Enter your commit message...")
      .pressSequentially("Test commit");
    await page.getByRole("button", { name: "Commit Changes" }).click();

    const dialog = await dialogPromise;
    expect(dialog.message()).toBe("Commit successful!");
    await dialog.accept();

    await expect(page.getByText("No changes have been staged.")).toBeVisible();
  });
});
