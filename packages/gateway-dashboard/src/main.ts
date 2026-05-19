function useV2Ui(): boolean {
  return new URLSearchParams(window.location.search).get("ui") === "v2";
}

function bootLegacy(): void {
  void import("./styles.css");
  void import("./legacy-app.js");
}

if (useV2Ui()) {
  void import("./v2/main");
} else {
  bootLegacy();
}
