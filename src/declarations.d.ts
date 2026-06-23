// esbuild loads .css entries as raw text strings.
declare module "*.css" {
  const content: string;
  export default content;
}

// Chrome Navigation API, not yet in lib.dom for the configured TS version.
// Used to detect same-document SPA navigations (history.pushState/replaceState)
// that never emit a `popstate` event.
declare const navigation:
  | { addEventListener: (type: "navigatesuccess", listener: () => void) => void }
  | undefined;
