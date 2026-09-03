// Lets node run the sim's TypeScript directly (node ≥ 23 strips types itself; the code is `erasableSyntaxOnly`):
// resolves the extensionless relative imports the bundler allows (`./types`) to their `.ts` files.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(spec, ctx, next) {
    if (/^\.\.?\//.test(spec) && !/\.[a-z]+$/i.test(spec)) {
      try { return next(spec + '.ts', ctx); } catch { /* not a .ts module — fall through */ }
    }
    return next(spec, ctx);
  },
});
