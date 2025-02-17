const darkModeToggle = document.querySelector("dark-mode-toggle");

// Only load the Twitter script when we need it.
const twitterLink = document.querySelector(".twitter-link");
let twitterLoaded = null;
if (twitterLink) {
  twitterLoaded = import("https://platform.twitter.com/widgets.js").then(() =>
    twitterLink.remove()
  );
}

// Toggles the `dark` class based on the dark mode toggle's mode
const root = document.documentElement;
const updateThemeClass = () => {
  root.classList.toggle("dark", darkModeToggle.mode === "dark");
};

// Set or remove the `dark` class the first time.
updateThemeClass();

// Listen for toggle changes (which includes `prefers-color-scheme` changes)
// and toggle the `dark` class accordingly.
darkModeToggle.addEventListener("colorschemechange", updateThemeClass);

// Navigation toggle.
const navToggle = document.querySelector("#nav-toggle");
navToggle.addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("header nav").classList.add("show");
  navToggle.classList.add("hide");
});

// A user right-clicking the logo probably wants to download it.
if (location.pathname !== "/logo") {
  const logo = document.querySelector("#header a");
  logo.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    self.location = "/logo";
  });
}

// Install our service worker.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

// Remove UTM garbage from URLs, to make it less likely such links get shared.
if (location.search.includes("utm_source")) {
  // This site doesn’t use query string parameters anyway, so we can just
  // set the location to `location.pathname` directly.
  history.replaceState({}, "", location.pathname);
}

// // Google Analytics.
// const UA_ID = "UA-65961526-1";
// self.GoogleAnalyticsObject = "ga";
// self.ga = (...args) => {
//   ga.q.push(args);
// };
// ga.l = Date.now();
// ga.q = [];
// ga("create", UA_ID, "auto");
// ga("set", "referrer", document.referrer.split("?")[0]);
// ga("send", "pageview");
// const gaScript = document.createElement("script");
// gaScript.src = "https://www.google-analytics.com/analytics.js";
// document.head.appendChild(gaScript);
