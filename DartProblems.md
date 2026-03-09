Honest answer: it's (b), the Dart-to-JS transpilation. But let me be specific about why.

The streamable HTTP stuff is inherently complex, but it's manageable complexity — session lifecycle, SSE streams, push notifications. That's just the nature of the protocol. Any language would have that.

The Dart-to-JS interop is where the accidental complexity lives:

Manual JSON serialization everywhere. You can't use dart:convert properly across the JS boundary, so you're hand-writing JSON string builders with manual escapeJson(). That's ~45+ lines of converters in types.dart alone, duplicated in the VSCode extension side. One missed escape and things fail silently.

Type safety dies at every JS boundary. You're casting req.body as JSObject, doing expressModule['json'] as JSFunction?, converting JSString → .toDart chains. The whole point of Dart is type safety, but at every interop point you're doing unsafe casts that could blow up at runtime.

Better-sqlite3 is synchronous and blocks the Node event loop. You chose it because async SQLite through JS interop would be even more painful, but now your entire HTTP server stalls on every DB call. You're stuck between two bad options because of the transpilation layer.

Promise/Future bridging is fragile. .toDart / .toJS everywhere, _asyncHandler wrappers, unawaited() calls for push notifications. Async bugs are hard to debug because the stack traces go through transpiled JS.

You can't leverage the Node.js ecosystem naturally. Every npm package needs an extension type wrapper with external declarations. Express, crypto, better-sqlite3 — each one is a mini-FFI layer you have to maintain.

The streamable HTTP transport adds complexity, sure — but that complexity would exist in any implementation. The Dart-to-JS layer is what makes every bug twice as hard to diagnose and every feature twice as long to implement. You're fighting the interop at every turn instead of just writing the logic.

If this were pure TypeScript on Node, or pure Dart on a Dart server (shelf/dart_frog), most of these pain points disappear. The problem is being in neither world fully.