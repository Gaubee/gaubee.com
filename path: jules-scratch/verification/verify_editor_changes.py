content:
```python
import re
from playwright.sync_api import Page, expect

def check_for_errors(page: Page):
    error_messages = page.locator(".toast-message")
    if error_messages.count() > 0:
        for i in range(error_messages.count()):
            message = error_messages.nth(i).inner_text()
            if "error" in message.lower():
                raise Exception(f"Error toast displayed: {message}")

def run(page: Page):
    page.goto("http://localhost:3000/admin/")
    page.wait_for_selector("text=Email")
    page.get_by_placeholder("you@example.com").click()
    page.get_by_placeholder("you@example.com").fill("dev@payloadcms.com")
    page.get_by_placeholder("password").click()
    page.get_by_placeholder("password").fill("test")
    page.get_by_role("button", name="Log In").click()
    page.wait_for_url("http://localhost:3000/admin")
    page.locator("nav").get_by_text("Articles").click()
    page.wait_for_url("http://localhost:3000/admin/collections/articles")
    page.locator(".row-1 > .cell-id > .cell > a").click()

    expect(page.get_by_text("Content", exact=True)).to_be_visible()
    expect(page.get_by_text("Metadata")).to_be_visible()

    # Check that the Slate editor is visible
    expect(page.locator(".slate-light-theme")).to_be_visible()

    page.screenshot(path="jules-scratch/verification/screenshot_wysiwyg.png")

    page.get_by_role("button", name="Raw").click()

    # Check that the Monaco editor is visible
    expect(page.locator(".monaco-editor")).to_be_visible()

    page.screenshot(path="jules-scratch/verification/screenshot_raw.png")

    page.get_by_role("button", name="Rich Text").click()

    expect(page.locator(".slate-light-theme")).to_be_visible()
```
