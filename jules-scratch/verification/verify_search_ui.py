import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # 1. Navigate to the app
        await page.goto("http://localhost:4321/")

        # 2. Find the search input and type a query
        search_input = page.locator("#search-input")
        await expect(search_input).to_be_visible()
        await search_input.press_sequentially("Iced", delay=100)
        await page.wait_for_timeout(1000) # Wait for search to trigger and modal to open

        # 3. Wait for the dialog to appear and check the title
        dialog_title = page.get_by_role("heading", name='搜索结果: "Iced"')
        await expect(dialog_title).to_be_visible()

        # 4. Assert that highlighted text is visible
        # We look for the <mark> tag we added for highlighting
        highlighted_text = page.locator("mark").first
        await expect(highlighted_text).to_be_visible()
        await expect(highlighted_text).to_have_text("Iced")

        # 5. Take a screenshot
        await page.screenshot(path="jules-scratch/verification/search_highlight.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
