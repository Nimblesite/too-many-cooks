/// E2E agent streaming test — spawn MCP server, open SSE stream
/// on /mcp for an AGENT session, trigger state changes from
/// another agent, ASSERT that notifications arrive over the
/// agent's SSE stream.
///
/// This PROVES that agents receive streamed notifications over
/// their Streamable HTTP SSE connection.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:dart_node_core/dart_node_core.dart';
import 'package:test/test.dart';
import 'package:too_many_cooks/too_many_cooks.dart' show serverBinary;

// ============================================================
// Named Constants
// ============================================================

const _baseUrl = 'http://localhost:4040';
const _mcpPath = '/mcp';
const _accept = 'application/json, text/event-stream';
const _mcpProtocolVersion = '2025-03-26';
const _defaultEventTimeoutMs = 3000;
const _streamEstablishDelayMs = 200;
const _serverPollDelayMs = 200;
const _eventPollDelayMs = 50;
const _maxServerPollAttempts = 30;

const _agent1Name = 'agent-stream-1';
const _agent2Name = 'agent-stream-2';
const _agent3Name = 'agent-stream-3';

const _testFilePath = '/agent-stream/test.dart';
const _testLockReason = 'agent streaming e2e';
const _testMessageContent = 'hello from agent1';
const _testGoal = 'Agent streaming goal';
const _testTask = 'Testing agent streaming';

const _eventAgentRegistered = 'agent_registered';
const _eventLockAcquired = 'lock_acquired';
const _eventLockReleased = 'lock_released';
const _eventMessageSent = 'message_sent';
const _eventPlanUpdated = 'plan_updated';

const _jsonRpcVersion = '2.0';
const _notificationMethod = 'notifications/message';
const _levelInfo = 'info';

const _dbDir = '.too_many_cooks';
const _dbFiles = ['data.db', 'data.db-wal', 'data.db-shm'];

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

  test('agent receives message_sent notification via SSE', () async {
    await _resetServer();
    final agent1 = _McpClient();
    final agent2 = _McpClient();
    await agent1.initSession();
    await agent2.initSession();

    final reg1 = _parseJson(
      await agent1.callTool('register', {'name': _agent1Name}),
    );
    final reg2 = _parseJson(
      await agent2.callTool('register', {'name': _agent2Name}),
    );
    final key1 = reg1['agent_key']! as String;

    final sse = await _AgentSseClient.connect(agent2.sessionId);

    await agent1.callTool('message', {
      'action': 'send',
      'agent_key': key1,
      'to_agent': reg2['agent_name']! as String,
      'content': _testMessageContent,
    });

    final events = await sse.waitForEvents(1);
    sse.close();

    expect(
      events.isNotEmpty,
      isTrue,
      reason: 'Agent2 MUST receive SSE event for message',
    );
    final eventType = _extractEventType(events.first);
    expect(
      eventType,
      equals(_eventMessageSent),
      reason: 'Event type MUST be $_eventMessageSent',
    );
  });

  test('agent receives lock_acquired notification via SSE', () async {
    await _resetServer();
    final agent1 = _McpClient();
    final agent2 = _McpClient();
    await agent1.initSession();
    await agent2.initSession();

    final reg1 = _parseJson(
      await agent1.callTool('register', {'name': _agent1Name}),
    );
    await agent2.callTool('register', {'name': _agent2Name});
    final key1 = reg1['agent_key']! as String;

    final sse = await _AgentSseClient.connect(agent2.sessionId);

    await agent1.callTool('lock', {
      'action': 'acquire',
      'file_path': _testFilePath,
      'agent_key': key1,
      'reason': _testLockReason,
    });

    final events = await sse.waitForEvents(1);
    sse.close();

    expect(
      events.isNotEmpty,
      isTrue,
      reason: 'Agent2 MUST receive SSE event for lock acquire',
    );
    final eventType = _extractEventType(events.first);
    expect(
      eventType,
      equals(_eventLockAcquired),
      reason: 'Event type MUST be $_eventLockAcquired',
    );
  });

  test('agent receives agent_registered notification via SSE', () async {
    await _resetServer();
    final agent1 = _McpClient();
    final agent2 = _McpClient();
    await agent1.initSession();
    await agent2.initSession();

    await agent1.callTool('register', {'name': _agent1Name});
    await agent2.callTool('register', {'name': _agent2Name});

    final sse = await _AgentSseClient.connect(agent2.sessionId);

    // Register a third agent — agent2 should get notified
    await agent1.callTool('register', {'name': _agent3Name});

    final events = await sse.waitForEvents(1);
    sse.close();

    expect(
      events.isNotEmpty,
      isTrue,
      reason: 'Agent2 MUST receive SSE event for new registration',
    );
    final eventType = _extractEventType(events.first);
    expect(
      eventType,
      equals(_eventAgentRegistered),
      reason: 'Event type MUST be $_eventAgentRegistered',
    );
  });

  test('agent receives plan_updated notification via SSE', () async {
    await _resetServer();
    final agent1 = _McpClient();
    final agent2 = _McpClient();
    await agent1.initSession();
    await agent2.initSession();

    final reg1 = _parseJson(
      await agent1.callTool('register', {'name': _agent1Name}),
    );
    await agent2.callTool('register', {'name': _agent2Name});
    final key1 = reg1['agent_key']! as String;

    final sse = await _AgentSseClient.connect(agent2.sessionId);

    await agent1.callTool('plan', {
      'action': 'update',
      'agent_key': key1,
      'goal': _testGoal,
      'current_task': _testTask,
    });

    final events = await sse.waitForEvents(1);
    sse.close();

    expect(
      events.isNotEmpty,
      isTrue,
      reason: 'Agent2 MUST receive SSE event for plan update',
    );
    final eventType = _extractEventType(events.first);
    expect(
      eventType,
      equals(_eventPlanUpdated),
      reason: 'Event type MUST be $_eventPlanUpdated',
    );
  });

  test('agent receives lock_released notification via SSE', () async {
    await _resetServer();
    final agent1 = _McpClient();
    final agent2 = _McpClient();
    await agent1.initSession();
    await agent2.initSession();

    final reg1 = _parseJson(
      await agent1.callTool('register', {'name': _agent1Name}),
    );
    await agent2.callTool('register', {'name': _agent2Name});
    final key1 = reg1['agent_key']! as String;

    // Acquire lock first
    await agent1.callTool('lock', {
      'action': 'acquire',
      'file_path': _testFilePath,
      'agent_key': key1,
      'reason': _testLockReason,
    });

    final sse = await _AgentSseClient.connect(agent2.sessionId);

    // Release the lock
    await agent1.callTool('lock', {
      'action': 'release',
      'file_path': _testFilePath,
      'agent_key': key1,
    });

    final events = await sse.waitForEvents(1);
    sse.close();

    expect(
      events.isNotEmpty,
      isTrue,
      reason: 'Agent2 MUST receive SSE event for lock release',
    );
    final eventType = _extractEventType(events.first);
    expect(
      eventType,
      equals(_eventLockReleased),
      reason: 'Event type MUST be $_eventLockReleased',
    );
  });

  test('agent notification has correct JSON-RPC payload structure', () async {
    await _resetServer();
    final agent1 = _McpClient();
    final agent2 = _McpClient();
    await agent1.initSession();
    await agent2.initSession();

    await agent1.callTool('register', {'name': _agent1Name});
    await agent2.callTool('register', {'name': _agent2Name});

    final sse = await _AgentSseClient.connect(agent2.sessionId);

    // Register agent3 to trigger a notification
    await agent1.callTool('register', {'name': _agent3Name});

    final events = await sse.waitForEvents(1);
    sse.close();

    expect(events.isNotEmpty, isTrue);

    final eventJson = _parseJson(events.first);

    // Verify JSON-RPC envelope
    expect(
      eventJson['jsonrpc'],
      equals(_jsonRpcVersion),
      reason: 'MUST have jsonrpc version',
    );
    expect(
      eventJson['method'],
      equals(_notificationMethod),
      reason: 'MUST have notifications/message method',
    );

    // Verify params structure
    final params = eventJson['params']! as Map<String, Object?>;
    expect(params['level'], equals(_levelInfo), reason: 'MUST have info level');

    // Verify data structure
    final data = params['data']! as Map<String, Object?>;
    expect(data.containsKey('event'), isTrue, reason: 'MUST contain event key');
    expect(
      data.containsKey('payload'),
      isTrue,
      reason: 'MUST contain payload key',
    );
    expect(
      data.containsKey('timestamp'),
      isTrue,
      reason: 'MUST contain timestamp key',
    );
    expect(
      data['event'],
      equals(_eventAgentRegistered),
      reason: 'Event type MUST be $_eventAgentRegistered',
    );
  });
}

// ============================================================
// Helper: parse JSON and extract event type
// ============================================================

Map<String, Object?> _parseJson(String text) =>
    jsonDecode(text) as Map<String, Object?>;

String? _extractEventType(String sseData) {
  final json = _parseJson(sseData);
  final params = json['params'] as Map<String, Object?>?;
  final data = params?['data'] as Map<String, Object?>?;
  return data?['event'] as String?;
}

// ============================================================
// Agent SSE Client — opens GET /mcp with agent session ID
// ============================================================

class _AgentSseClient {
  _AgentSseClient._();

  final _events = <String>[];
  var _consumed = 0;
  _SseReader? _reader;

  static Future<_AgentSseClient> connect(String sessionId) async {
    final client = _AgentSseClient._();
    client._reader = await _SseReader.open(
      '$_baseUrl$_mcpPath',
      sessionId,
      client._events,
    );
    await Future<void>.delayed(
      const Duration(milliseconds: _streamEstablishDelayMs),
    );
    return client;
  }

  Future<List<String>> waitForEvents(
    int count, {
    int timeoutMs = _defaultEventTimeoutMs,
  }) async {
    final start = DateTime.now().millisecondsSinceEpoch;
    while (DateTime.now().millisecondsSinceEpoch - start < timeoutMs) {
      if (_events.length - _consumed >= count) {
        final result = _events.sublist(_consumed);
        _consumed = _events.length;
        return result;
      }
      await Future<void>.delayed(
        const Duration(milliseconds: _eventPollDelayMs),
      );
    }
    final result = _events.sublist(_consumed);
    _consumed = _events.length;
    return result;
  }

  void close() {
    _reader?.abort();
  }
}

// ============================================================
// SSE stream reader
// ============================================================

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
// Shared HTTP / Node.js helpers
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
  if (value == null || value.isUndefinedOrNull) return null;
  return (value as JSString).toDart;
}

// ============================================================
// MCP Client with exposed session ID
// ============================================================

class _McpClient {
  String _sessionId = '';
  var _nextId = 1;

  String get sessionId {
    if (_sessionId.isEmpty) {
      throw StateError('Session not initialized');
    }
    return _sessionId;
  }

  Future<void> initSession() async {
    final initResult = await _request('initialize', {
      'protocolVersion': _mcpProtocolVersion,
      'capabilities': <String, Object?>{},
      'clientInfo': {'name': 'agent-streaming-e2e', 'version': '1.0.0'},
    });
    if (_sessionId.isEmpty) {
      throw StateError('No session ID after init: $initResult');
    }
    await _postMcp(
      jsonEncode({
        'jsonrpc': _jsonRpcVersion,
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
      'jsonrpc': _jsonRpcVersion,
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
    if (_sessionId.isNotEmpty) {
      headers['mcp-session-id'] = _sessionId.toJS;
    }
    final options = JSObject()
      ..['method'] = 'POST'.toJS
      ..['headers'] = headers
      ..['body'] = body.toJS;
    final response = await _jsFetch('$_baseUrl$_mcpPath'.toJS, options).toDart;
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
// Server lifecycle helpers
// ============================================================

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
  for (var i = 0; i < _maxServerPollAttempts; i++) {
    try {
      final r = await _jsFetch('$_baseUrl/admin/status'.toJS).toDart;
      final ok = r['ok'] as JSBoolean?;
      if (ok != null && ok.toDart) return;
    } on Object {
      // Not ready yet
    }
    if (i == _maxServerPollAttempts - 1) {
      throw StateError('Server failed to start');
    }
    await Future<void>.delayed(
      const Duration(milliseconds: _serverPollDelayMs),
    );
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

  for (final file in _dbFiles) {
    final path = '$_dbDir/$file';
    final exists =
        (existsSync.callAsFunction(fs, path.toJS) as JSBoolean?)?.toDart ??
        false;
    if (exists) {
      unlinkSync.callAsFunction(fs, path.toJS);
    }
  }
}
