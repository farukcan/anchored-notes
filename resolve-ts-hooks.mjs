// Test-only module resolution. Source files import siblings with a `.js`
// specifier (what the esbuild bundle and the browser expect), but on disk only
// the `.ts` file exists, so `node --test` can't resolve them. Rewrite those
// specifiers to the TypeScript file the runtime then type-strips.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
