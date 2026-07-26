// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    /**
     * 页面 state：NavController 的三份 area location state。
     * 经 SvelteKit pushState/replaceState 写入 history.state['sveltekit:states']，
     * 替代直接 window.history.pushState（避免与 SvelteKit router 冲突）。
     */
    interface PageState {
      main?: unknown;
      bottom?: unknown;
      pop?: unknown;
    }
    // interface Platform {}
  }
}

export {};
