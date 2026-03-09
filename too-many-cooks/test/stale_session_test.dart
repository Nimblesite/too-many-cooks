/// Test: server returns 404 for stale/unknown MCP session IDs.
///
/// BUG: POST /mcp with an unknown mcp-session-id returns 400
/// instead of 404. Per the MCP Streamable HTTP spec, 404 tells
/// the client the session expired and it should re-initialize.
/// Returning 400 leaves clients stuck — they think the request
/// format is wrong rather than the session being stale.
library;

import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:dart_node_core/dart_node_core.dart';
import 'package:test/test.dart';
import 'package:too_many_cooks/too_many_cooks.dart' show serverBinary;

const _baseUrl = 'http://localhost:4040';
const _accept = 'application/json, text/event-stream';
const _mcpPath = '/mcp';
const _adminEventsPath = '/admin/events';

/// Expected HTTP status for unknown session IDs per MCP spec.
const _sessionNotFoundStatus = 404;

@JS('globalThis.fetch')
external JSPromise<JSObject> _jsFetch(JSString url, [JSObject? options]);

void main() {
  // `late` required by test framework setUpAll/tearDownAll lifecycle.
  // ignore: no_late
  late JSObject serverProcess;

  setUpAll(() async {
    _deleteDbFiles();
    serverProcess = _spawnServer();
    await _waitForServer();
  });

  tearDownAll(() {
    _killProcess(serverProcess);
    _deleteDbFiles();
  });

  test('POST /mcp with stale session ID returns 404', () async {
    final headers = JSObject()
      ..['Content-Type'] = 'application/json'.toJS
      ..['Accept'] = _accept.toJS
      ..['mcp-session-id'] = 'deadbeef-0000-0000-0000-000000000000'.toJS;

    final body = jsonEncode({
      'jsonrpc': '2.0',
      'id': 1,
      'method': 'tools/call',
      'params': {'name': 'status', 'arguments': <String, Object?>{}},
    });

    final options = JSObject()
      ..['method'] = 'POST'.toJS
      ..['headers'] = headers
      ..['body'] = body.toJS;

    final response = await _jsFetch('$_baseUrl$_mcpPath'.toJS, options).toDart;

    final status = (response['status'] as JSNumber?)?.toDartInt ?? 0;

    expect(
      status,
      equals(_sessionNotFoundStatus),
      reason:
          'Server MUST return 404 for unknown session IDs '
          'per MCP Streamable HTTP spec. Got $status '
          'instead.',
    );
  });

  test('GET /mcp with stale session ID returns 404', () async {
    final headers = JSObject()
      ..['Accept'] = 'text/event-stream'.toJS
      ..['mcp-session-id'] = 'deadbeef-0000-0000-0000-000000000000'.toJS;

    final options = JSObject()
      ..['method'] = 'GET'.toJS
      ..['headers'] = headers;

    final response = await _jsFetch('$_baseUrl$_mcpPath'.toJS, options).toDart;

    final status = (response['status'] as JSNumber?)?.toDartInt ?? 0;

    expect(
      status,
      equals(_sessionNotFoundStatus),
      reason:
          'Server MUST return 404 for unknown session IDs '
          'on GET /mcp. Got $status instead.',
    );
  });

  test('POST /admin/events with stale session ID returns 404', () async {
    final headers = JSObject()
      ..['Content-Type'] = 'application/json'.toJS
      ..['Accept'] = _accept.toJS
      ..['mcp-session-id'] = 'deadbeef-0000-0000-0000-000000000000'.toJS;

    final body = jsonEncode({
      'jsonrpc': '2.0',
      'id': 1,
      'method': 'tools/call',
      'params': {'name': 'status', 'arguments': <String, Object?>{}},
    });

    final options = JSObject()
      ..['method'] = 'POST'.toJS
      ..['headers'] = headers
      ..['body'] = body.toJS;

    final response = await _jsFetch(
      '$_baseUrl$_adminEventsPath'.toJS,
      options,
    ).toDart;

    final status = (response['status'] as JSNumber?)?.toDartInt ?? 0;

    expect(
      status,
      equals(_sessionNotFoundStatus),
      reason:
          'Server MUST return 404 for unknown session IDs '
          'on POST /admin/events. Got $status instead.',
    );
  });

  test('GET /admin/events with stale session ID returns 404', () async {
    final headers = JSObject()
      ..['Accept'] = 'text/event-stream'.toJS
      ..['mcp-session-id'] = 'deadbeef-0000-0000-0000-000000000000'.toJS;

    final options = JSObject()
      ..['method'] = 'GET'.toJS
      ..['headers'] = headers;

    final response = await _jsFetch(
      '$_baseUrl$_adminEventsPath'.toJS,
      options,
    ).toDart;

    final status = (response['status'] as JSNumber?)?.toDartInt ?? 0;

    expect(
      status,
      equals(_sessionNotFoundStatus),
      reason:
          'Server MUST return 404 for unknown session IDs '
          'on GET /admin/events. Got $status instead.',
    );
  });
}

JSObject _spawnServer() {
  final childProcess = requireModule('child_process') as JSObject;
  final spawnFn = childProcess['spawn']! as JSFunction;

  return spawnFn.callAsFunction(
        null,
        'node'.toJS,
        <String>[serverBinary].jsify(),
        <String, Object?>{
          'stdio': ['pipe', 'pipe', 'inherit'],
        }.jsify(),
      )!
      as JSObject;
}

void _killProcess(JSObject process) {
  (process['kill']! as JSFunction).callAsFunction(process);
}

Future<void> _waitForServer() async {
  for (var i = 0; i < 30; i++) {
    try {
      final r = await _jsFetch('$_baseUrl/admin/status'.toJS).toDart;
      final ok = r['ok'] as JSBoolean?;
      if (ok != null && ok.toDart) break;
    } on Object {
      // Not ready yet
    }
    if (i == 29) {
      throw StateError('Server failed to start');
    }
    await Future<void>.delayed(const Duration(milliseconds: 200));
  }
}

void _deleteDbFiles() {
  final fs = requireModule('fs') as JSObject;
  final unlinkSync = fs['unlinkSync']! as JSFunction;
  final existsSync = fs['existsSync']! as JSFunction;

  const dbDir = '.too_many_cooks';
  for (final file in ['data.db', 'data.db-wal', 'data.db-shm']) {
    final path = '$dbDir/$file';
    final exists =
        (existsSync.callAsFunction(fs, path.toJS) as JSBoolean?)?.toDart ??
        false;
    if (exists) {
      unlinkSync.callAsFunction(fs, path.toJS);
    }
  }
}
