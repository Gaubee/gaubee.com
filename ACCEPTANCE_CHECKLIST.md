# Acceptance Checklist

Ahoy, Captain! Here is the checklist for testing and verifying the new Astro-based blog system on your own machine. The sandbox environment has proven to be unreliable, but the code itself should be sound.

## 1. Prerequisites

- Make sure you have [Node.js](https://nodejs.org/) (version 18 or higher recommended) installed.
- Make sure you have [pnpm](https://pnpm.io/installation) installed.

## 2. Setup Instructions

1.  **Install Dependencies:** Open your terminal in the project root and run:

    ```bash
    pnpm install
    ```

    This will install all the necessary packages like Astro, React, Lit, etc.

2.  **Set up Environment Variable (for translation):**
    - Create a new file named `.env` in the root of the project.
    - Add your Google AI API key to this file like so:
      ```
      GOOGLE_API_KEY=AIzaSy...your...key...
      ```
    - The `.gitignore` file is already configured to ignore this file, so it will not be committed.

## 3. Verification Steps

### A. Development Server

1.  **Run the dev server:**
    ```bash
    pnpm run dev
    ```
2.  **Check the Output:** The terminal should show a local URL, usually `http://localhost:4321`.
3.  **Verify Homepage:** Open this URL in your browser.
    - You should see the homepage with the title "GauBee's Blog".
    - The page should display a grid of cards, each representing an article or event from your `src/content` directory.
    - The cards should be sorted with the most recent posts first.

### B. Production Build

1.  **Run the build command:**
    ```bash
    pnpm run build
    ```
2.  **Check the Output:** This command should create a `dist` directory. Inside `dist`, you should find:
    - An `index.html` file (the homepage).
    - An `articles` directory containing the static HTML for each article.
    - An `events` directory containing the static HTML for each event.
    - An `assets` directory with bundled JavaScript and CSS.

### C. Component Testing

1.  **Edit a Markdown File:** Open any file in `src/content/articles` or `src/content/events`.
2.  **Add Component Tags:** Add the following tags to the bottom of the file to test the custom components:

    ```html
    <hr />
    <h3>Component Test</h3>

    <com-youtube-player videoId="dQw4w9WgXcQ"></com-youtube-player>

    <com-mix-blend-mode-gradient-text></com-mix-blend-mode-gradient-text>
    ```

3.  **Test in Dev Mode:** Run `pnpm run dev` and navigate to the page for that article/event (e.g., `http://localhost:4321/articles/0001.js-tree-index-multiple-keywords-and-check`). You should see the YouTube player and the gradient text effect rendered on the page.

### D. Translation Script (Optional)

1.  **Run the script:** Make sure you have completed the `.env` setup from step 2. Then run:
    ```bash
    pnpm run translate
    ```
2.  **Verify Output:** The script should process all files in `src/content` and create translated versions in the `i18n/en/articles` and `i18n/en/events` directories. The new files will have a hash in their name (e.g., `0001.js-tree-index-multiple-keywords-and-check.HASH.md`).
    - **Note on Type Errors:** The script may still show a type error related to `@google/genai`. This appears to be an environmental issue with the sandbox. The script should still function correctly despite this error.

---

If all these steps pass on your machine, then our refactoring voyage has been a success! Arrr! 🏴‍☠️
