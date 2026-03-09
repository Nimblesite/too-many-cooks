/// Regression test: server must not crash when writing to the log file
/// in a workspace whose logs/ directory does not yet exist.
///
/// Reproduces: ENOENT crash on appendFileSync when TMC_WORKSPACE points
/// to a directory that has never had a logs/ subdirectory created.
library;

import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:dart_node_core/dart_node_core.dart';
import 'package:test/test.dart';
import 'package:too_many_cooks/too_many_cooks.dart' show serverBinary;

const _port = 4041;
const _baseUrl = 'http://localhost:$_port';
const _accept = 'application/json, text/event-stream';

/// HTTP fetch (Node.js global).
@JS('globalThis.fetch')
external JSPromise<JSObject> _jsFetch(JSString url, [JSObject? options]);

void main() {
  group('Log directory creation', () {
    late JSObject serverProcess;
    late String tmpWorkspace;

    setUpAll(() async {
      // Create a fresh temp workspace with NO logs/ subdirectory.
      final fs = requireModule('fs') as JSObject;
      final mkdtempFn = fs['mkdtempSync']! as JSFunction;
      final result = mkdtempFn.callAsFunction(null, '/tmp/tmc-log-test-'.toJS);
      if (result == null) throw StateError('mkdtempSync returned null');
      tmpWorkspace = (result as JSString).toDart;

      serverProcess = _spawnServerWithWorkspace(tmpWorkspace);
      await _waitForServer();
    });

    tearDownAll(() {
      _killProcess(serverProcess);
      final fs = requireModule('fs') as JSObject;
      final rmFn = fs['rmSync'] as JSFunction?;
      rmFn?.callAsFunction(
        null,
        tmpWorkspace.toJS,
        <String, Object?>{'recursive': true, 'force': true}.jsify(),
      );
    });

    test(
      'server survives a bad MCP request that triggers error logging',
      () async {
        // POST to /mcp with no session-id and a non-initialize body.
        // This returns 400 and triggers _asyncHandler's error-log path
        // (appendFileSync). Before the fix, this crashed the server with
        // ENOENT because the logs/ dir was never created.
        final headers = JSObject()
          ..['Content-Type'] = 'application/json'.toJS
          ..['Accept'] = _accept.toJS;
        final options = JSObject()
          ..['method'] = 'POST'.toJS
          ..['headers'] = headers
          ..['body'] = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'.toJS;

        final response = await _jsFetch('$_baseUrl/mcp'.toJS, options).toDart;

        final status = (response['status'] as JSNumber?)?.toDartInt ?? 0;
        expect(
          status,
          equals(400),
          reason: 'Server should return 400 for bad request',
        );

        // Give the server a moment to process, then confirm it is alive.
        await Future<void>.delayed(const Duration(milliseconds: 300));

        final statusResponse = await _jsFetch(
          '$_baseUrl/admin/status'.toJS,
        ).toDart;
        final ok = (statusResponse['ok'] as JSBoolean?)?.toDart ?? false;
        expect(
          ok,
          isTrue,
          reason: 'Server must still be alive after bad request',
        );
      },
    );

    test('logs/ directory is created in workspace on startup', () {
      final fs = requireModule('fs') as JSObject;
      final existsFn = fs['existsSync']! as JSFunction;
      final pathMod = requireModule('path') as JSObject;
      final joinFn = pathMod['join']! as JSFunction;
      final logsDir =
          (joinFn.callAsFunction(null, tmpWorkspace.toJS, 'logs'.toJS)
                  as JSString?)
              ?.toDart ??
          '';
      final exists =
          (existsFn.callAsFunction(null, logsDir.toJS) as JSBoolean?)?.toDart ??
          false;
      expect(
        exists,
        isTrue,
        reason: 'logs/ directory must be created in TMC_WORKSPACE on startup',
      );
    });
  });
}

@JS('process.env.PATH')
external JSString? get _envPath;

JSObject _spawnServerWithWorkspace(String workspace) {
  final childProcess = requireModule('child_process') as JSObject;
  final spawnFn = childProcess['spawn']! as JSFunction;
  return spawnFn.callAsFunction(
        null,
        'node'.toJS,
        <String>[serverBinary].jsify(),
        <String, Object?>{
          'stdio': ['pipe', 'pipe', 'inherit'],
          'env': <String, Object?>{
            'PATH': _envPath?.toDart ?? '/usr/local/bin:/usr/bin:/bin',
            'TMC_WORKSPACE': workspace,
            'TMC_PORT': '$_port',
          },
        }.jsify(),
      )!
      as JSObject;
}

void _killProcess(JSObject process) {
  (process['kill']! as JSFunction).callAsFunction(process);
}

Future<void> _waitForServer() async {
  for (var i = 0; i < 50; i++) {
    try {
      final r = await _jsFetch('$_baseUrl/admin/status'.toJS).toDart;
      final ok = r['ok'] as JSBoolean?;
      if (ok != null && ok.toDart) return;
    } on Object {
      // not ready yet
    }
    if (i == 49) throw StateError('Server failed to start');
    await Future<void>.delayed(const Duration(milliseconds: 200));
  }
}
