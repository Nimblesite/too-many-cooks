/// Test: admin SSE stream survives /admin/reset.
///
/// BUG: /admin/reset clears hub.servers and hub.transports,
/// which kills the admin SSE event push for any connected
/// VSIX clients. After reset, no admin events are delivered
/// via SSE until the client reconnects.
///
/// This test proves that an admin SSE stream established
/// BEFORE a reset continues to receive events AFTER the
/// reset — exactly like the VSIX extension's lifecycle.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:dart_node_core/dart_node_core.dart';
import 'package:test/test.dart';
import 'package:too_many_cooks/too_many_cooks.dart' show serverBinary;

const _baseUrl = 'http://localhost:4040';
const _accept = 'application/json, text/event-stream';
const _adminEventsPath = '/admin/events';
const _mcpProtocolVersion = '2025-03-26';
const _eventTimeoutMs = 2000;
const _streamSettleMs = 200;
const _pollIntervalMs = 50;

void main() {
  // Server process shared across all tests
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

  test('admin SSE stream receives events AFTER /admin/reset', () async {
    // 1. Open admin SSE stream (like VSIX does on connect)
    final sse = await _AdminSseClient.connect();

    // 2. Reset server (like VSIX streaming test suiteSetup)
    await _resetServer();

    // 3. Consume any events from the reset itself
    //    (state_reset is sent BEFORE hub.servers is cleared)
    await sse.waitForEvents(1);

    // 4. Create MCP session and register agent AFTER reset
    final mcpClient = _McpClient();
    await mcpClient.initSession();
    await mcpClient.callTool('register', {'name': 'post-reset-agent'});

    // 5. ASSERT: SSE stream MUST still receive the
    //    agent_registered event (sent AFTER reset cleared
    //    hub.servers). This is the bug: after reset clears
    //    hub.servers, pushEvent iterates an empty map and
    //    delivers nothing.
    final events = await sse.waitForEvents(1);
    sse.close();

    expect(
      events.isNotEmpty,
      isTrue,
      reason:
          'Admin SSE stream MUST receive events after '
          '/admin/reset. The reset should clear test data '
          'but NOT destroy admin SSE connections.',
    );

    // Verify it's an agent_registered event
    final eventJson = jsonDecode(events.first) as Map<String, Object?>;
    final params = eventJson['params'] as Map<String, Object?>?;
    final data = params?['data'] as Map<String, Object?>?;
    expect(
      data?['event'],
      equals('agent_registered'),
      reason: 'Event after reset MUST be agent_registered',
    );
  });
}

// ============================================================
// Admin SSE Client
// ============================================================

class _AdminSseClient {
  _AdminSseClient._();

  final _events = <String>[];
  var _consumed = 0;
  _SseReader? _reader;

  static Future<_AdminSseClient> connect() async {
    final sessionId = await _initAdminSession();
    final client = _AdminSseClient._();
    client._reader = await _SseReader.open(
      '$_baseUrl$_adminEventsPath',
      sessionId,
      client._events,
    );
    await Future<void>.delayed(const Duration(milliseconds: _streamSettleMs));
    return client;
  }

  Future<List<String>> waitForEvents(
    int count, {
    int timeoutMs = _eventTimeoutMs,
  }) async {
    final start = DateTime.now().millisecondsSinceEpoch;
    while (DateTime.now().millisecondsSinceEpoch - start < timeoutMs) {
      if (_events.length - _consumed >= count) {
        final result = _events.sublist(_consumed);
        _consumed = _events.length;
        return result;
      }
      await Future<void>.delayed(const Duration(milliseconds: _pollIntervalMs));
    }
    final result = _events.sublist(_consumed);
    _consumed = _events.length;
    return result;
  }

  void close() {
    _reader?.abort();
  }
}

Future<String> _initAdminSession() async {
  final headers = JSObject()
    ..['Content-Type'] = 'application/json'.toJS
    ..['Accept'] = _accept.toJS;
  final body = jsonEncode({
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'initialize',
    'params': {
      'protocolVersion': _mcpProtocolVersion,
      'capabilities': <String, Object?>{},
      'clientInfo': {'name': 'admin-reset-sse-test', 'version': '1.0.0'},
    },
  });
  final options = JSObject()
    ..['method'] = 'POST'.toJS
    ..['headers'] = headers
    ..['body'] = body.toJS;

  final response = await _jsFetch(
    '$_baseUrl$_adminEventsPath'.toJS,
    options,
  ).toDart;

  final sessionId = _getResponseHeader(response, 'mcp-session-id');
  if (sessionId == null) {
    throw StateError('No admin session ID');
  }

  final notifyHeaders = JSObject()
    ..['Content-Type'] = 'application/json'.toJS
    ..['Accept'] = _accept.toJS
    ..['mcp-session-id'] = sessionId.toJS;
  final notifyBody = jsonEncode({
    'jsonrpc': '2.0',
    'method': 'notifications/initialized',
    'params': <String, Object?>{},
  });
  final notifyOpts = JSObject()
    ..['method'] = 'POST'.toJS
    ..['headers'] = notifyHeaders
    ..['body'] = notifyBody.toJS;
  await _jsFetch('$_baseUrl$_adminEventsPath'.toJS, notifyOpts).toDart;

  return sessionId;
}

class _SseReader {
  _SseReader._(this._controller);

  final JSObject _controller;
  static const _dataPrefix = 'data: ';

  static Future<_SseReader> open(
    String url,
    String sessionId,
    List<String> events,
  ) async {
    final controller = _createAbortController();
    final signal = controller['signal']!;

    final headers = JSObject()
      ..['Accept'] = _accept.toJS
      ..['mcp-session-id'] = sessionId.toJS;
    final options = JSObject()
      ..['method'] = 'GET'.toJS
      ..['headers'] = headers
      ..['signal'] = signal;

    unawaited(
      Future<void>(() async {
        try {
          final response = await _jsFetch(url.toJS, options).toDart;
          final ok = response['ok'] as JSBoolean?;
          if (ok == null || !ok.toDart) return;

          final body = response['body'];
          if (body == null || body.isUndefinedOrNull) {
            return;
          }

          final reader =
              ((body as JSObject)['getReader']! as JSFunction).callAsFunction(
                    body,
                  )!
                  as JSObject;
          final decoder = _createTextDecoder();
          var buffer = '';

          for (;;) {
            final chunk =
                await ((reader['read']! as JSFunction).callAsFunction(reader)!
                        as JSPromise<JSObject>)
                    .toDart;

            final done = chunk['done'] as JSBoolean?;
            if (done != null && done.toDart) break;

            final value = chunk['value'];
            if (value == null || value.isUndefinedOrNull) {
              continue;
            }

            final decoded =
                (decoder['decode']! as JSFunction).callAsFunction(
                      decoder,
                      value,
                      _streamOptions,
                    )!
                    as JSString;
            final buf = StringBuffer(buffer)..write(decoded.toDart);
            buffer = buf.toString();

            final lines = buffer.split('\n');
            buffer = lines.removeLast();
            for (final line in lines) {
              if (line.startsWith(_dataPrefix)) {
                final data = line.substring(_dataPrefix.length).trim();
                if (data.isNotEmpty) {
                  events.add(data);
                }
              }
            }
          }
        } on Object {
          // Stream aborted — expected on close()
        }
      }),
    );

    return _SseReader._(controller);
  }

  void abort() {
    (_controller['abort']! as JSFunction).callAsFunction(_controller);
  }
}

// ============================================================
// MCP Client
// ============================================================

class _McpClient {
  String? _sessionId;
  var _nextId = 1;

  Future<void> initSession() async {
    await _request('initialize', {
      'protocolVersion': _mcpProtocolVersion,
      'capabilities': <String, Object?>{},
      'clientInfo': {'name': 'admin-reset-mcp', 'version': '1.0.0'},
    });
    if (_sessionId == null) {
      throw StateError('No session ID after init');
    }
    await _postMcp(
      jsonEncode({
        'jsonrpc': '2.0',
        'method': 'notifications/initialized',
        'params': <String, Object?>{},
      }),
    );
  }

  Future<String> callTool(String name, Map<String, Object?> args) async {
    final result = await _request('tools/call', {
      'name': name,
      'arguments': args,
    });
    final content = (result['content']! as List).first as Map<String, Object?>;
    return content['text']! as String;
  }

  Future<Map<String, Object?>> _request(
    String method,
    Map<String, Object?> params,
  ) async {
    final id = _nextId++;
    final body = jsonEncode({
      'jsonrpc': '2.0',
      'id': id,
      'method': method,
      'params': params,
    });
    final response = await _postMcp(body);
    final text = await _responseText(response);
    final json = _parseMcpResponse(text);
    if (json.containsKey('error')) {
      final error = json['error']! as Map<String, Object?>;
      final message = error['message'] as String? ?? 'Error';
      return <String, Object?>{
        'isError': true,
        'content': <Object>[
          <String, Object?>{'type': 'text', 'text': message},
        ],
      };
    }
    return json['result']! as Map<String, Object?>;
  }

  Future<JSObject> _postMcp(String body) async {
    final headers = JSObject()
      ..['Content-Type'] = 'application/json'.toJS
      ..['Accept'] = _accept.toJS;
    if (_sessionId != null) {
      headers['mcp-session-id'] = _sessionId!.toJS;
    }
    final options = JSObject()
      ..['method'] = 'POST'.toJS
      ..['headers'] = headers
      ..['body'] = body.toJS;
    final response = await _jsFetch('$_baseUrl/mcp'.toJS, options).toDart;
    final sid = _getResponseHeader(response, 'mcp-session-id');
    if (sid != null) _sessionId = sid;
    return response;
  }

  Future<String> _responseText(JSObject response) async {
    final text =
        await ((response['text'] as JSFunction?)?.callAsFunction(response)
                as JSPromise<JSString>?)
            ?.toDart;
    return text?.toDart ?? '';
  }

  Map<String, Object?> _parseMcpResponse(String text) {
    if (text.trimLeft().startsWith('{')) {
      return jsonDecode(text) as Map<String, Object?>;
    }
    for (final line in text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          return jsonDecode(line.substring(6)) as Map<String, Object?>;
        } on Object {
          continue;
        }
      }
    }
    throw StateError('Could not parse: $text');
  }
}

// ============================================================
// Shared helpers
// ============================================================

@JS('globalThis.fetch')
external JSPromise<JSObject> _jsFetch(JSString url, [JSObject? options]);

@JS('globalThis.AbortController')
external JSFunction get _abortControllerCtor;

JSObject _createAbortController() =>
    _abortControllerCtor.callAsConstructor<JSObject>();

@JS('globalThis.TextDecoder')
external JSFunction get _textDecoderCtor;

JSObject _createTextDecoder() => _textDecoderCtor.callAsConstructor<JSObject>();

final JSObject _streamOptions = JSObject()..['stream'] = true.toJS;

String? _getResponseHeader(JSObject response, String name) {
  final headers = response['headers'] as JSObject?;
  if (headers == null) return null;
  final getFn = headers['get'] as JSFunction?;
  final value = getFn?.callAsFunction(headers, name.toJS);
  if (value == null || value.isUndefinedOrNull) {
    return null;
  }
  return (value as JSString).toDart;
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
      if (ok != null && ok.toDart) return;
    } on Object {
      // Not ready yet
    }
    if (i == 29) throw StateError('Server failed to start');
    await Future<void>.delayed(const Duration(milliseconds: 200));
  }
}

Future<void> _resetServer() async {
  final options = JSObject()
    ..['method'] = 'POST'.toJS
    ..['headers'] = (JSObject()..['Content-Type'] = 'application/json'.toJS);
  final r = await _jsFetch('$_baseUrl/admin/reset'.toJS, options).toDart;
  final ok = r['ok'] as JSBoolean?;
  if (ok == null || !ok.toDart) {
    throw StateError('Failed to reset server');
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
