# Blazor

## Rules

## Gotchyas

- [rT4nQ8] Razor component parameters are NOT compile-checked - an unknown parameter on a component (eg `Router NotFoundPage=...`) builds clean and throws at runtime via `ComponentProperties.ThrowForUnknownIncomingParameterName`; after any Blazor/.NET version change, verify parameters exist on the RUNTIME component assemblies, not just that the build passes.
- [bN2wX5] `@bind` on a text input defaults to the `change` event (fires on blur/enter), NOT `input` - programmatically dispatched `input` events or expectations of per-keystroke updates silently do nothing; use `@bind:event="oninput"` (or dispatch `change`) when live updates are needed.

## Issues & Solutions

- [kR7vD2] Router NotFoundPage - MAUI Blazor Hybrid app stuck on "Loading..." with footer "An unhandled error has occurred. Reload" and console error "Object of type 'Microsoft.AspNetCore.Components.Routing.Router' does not have a property matching the name 'NotFoundPage'"
  Cause: `Router.NotFoundPage` is a .NET 10-only parameter; a net9-targeted app restores 9.0.x Microsoft.AspNetCore.Components packages whose Router lacks it (often surfaced after an SDK/MAUI workload update changes which package band `$(MauiVersion)`/WebView.Maui resolves). Razor parameters are runtime-bound, so the build never catches it.
  Fix: replace `NotFoundPage="typeof(...)"` on the Router with the .NET 9-compatible `<NotFound>` child fragment (LayoutView + message), or retarget the app to net10.0. Diagnose fast by launching with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and reading the WebView2 console via CDP - the full .NET exception is logged there. (2026-08)
- [qF5mL8] @for loop lambda capture - EVERY per-item @onclick button in a rendered list silently does nothing (up/down/remove/expand all dead) with no error anywhere
  Cause: lambdas like `@onclick="() => MoveAsync(i)"` inside `@for (var i = 0; ...)` capture the loop variable BY REFERENCE (C# for-loops share one variable across iterations), so at click time every handler receives the FINAL value (count) and index guards make every call a no-op. The build passes, no exception is thrown, and it looks like "the UI is not interactive".
  Fix: declare a loop-local copy inside the loop body (`var index = i;`) and use THAT in every lambda and per-item binding. Watch for it in code review whenever a Razor loop wires per-item events; the compiler never warns. (2026-08)
- [jS9kR3] Failed to fetch dynamically imported module - colocated `.razor.js` JS-isolation import 404s in a MAUI Blazor Hybrid app when imported via `_content/{Assembly}/...`
  Cause: the `_content/{AssemblyName}/` prefix only applies to Razor class libraries; the app's OWN colocated scripts are served at their PROJECT-RELATIVE path (eg `Components/Pages/Home.razor.js`), visible as routes in `staticwebassets.build.json`.
  Fix: import with the project-relative path (`./Components/Pages/Home.razor.js`), and always wrap the import in try/catch so a failed enhancement cannot break the page. Check `obj/.../staticwebassets.build.json` route entries when in doubt. (2026-08)
- [nV6pQ2] CS0411 CreateVirtualize_0 - "The type arguments for method 'TypeInference.CreateVirtualize_0<TItem>' cannot be inferred from the usage" at build
  Cause: `<Virtualize Items="...">` is bound to an `IEnumerable<T>` (eg a LINQ Where without materializing); the component's Items parameter requires `ICollection<T>`, and the Razor source generator cannot infer TItem through the mismatch.
  Fix: materialize the sequence before binding (`.ToList()`) so Items is an `ICollection<T>` - also avoids repeated LINQ enumeration per render. (2026-08)
