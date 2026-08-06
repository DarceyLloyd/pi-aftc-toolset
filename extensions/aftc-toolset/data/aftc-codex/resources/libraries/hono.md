# Hono

## Rules

## Gotchyas

- [nQG1KQ] Hono has no app.add() for dynamic-method registration and returns 404 (not 405) when a known path is hit with the wrong HTTP method; register dynamic methods with app.on(method, path, handler), and to emit proper 405s keep your own route registry and scan it inside app.notFound - return 405 with an Allow header when the path matches other methods

- [O62Ozo] Hono's BlankEnv makes ctx.set('key', v) a type error ('key' not assignable to never); declare the variable globally once via `declare module 'hono' { interface ContextVariableMap { auth: AuthState } }` so set/get are typed everywhere

## Issues & Solutions
