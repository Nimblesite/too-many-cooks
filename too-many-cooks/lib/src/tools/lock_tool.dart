/// Lock tool - file lock management.
library;

import 'dart:convert' show jsonEncode;

import 'package:dart_logging/dart_logging.dart';
import 'package:dart_node_mcp/dart_node_mcp.dart';
import 'package:nadz/nadz.dart';
import 'package:too_many_cooks/src/config.dart';
import 'package:too_many_cooks/src/data/data.dart';
import 'package:too_many_cooks/src/notifications.dart';
import 'package:too_many_cooks/src/types.dart';

/// Input schema for lock tool.
const lockInputSchema = <String, Object?>{
  'type': 'object',
  'properties': {
    'action': {
      'type': 'string',
      'enum': ['acquire', 'release', 'force_release', 'renew', 'query', 'list'],
      'description': 'Lock action to perform',
    },
    'file_path': {
      'type': 'string',
      'description': 'File path to lock (required except for list)',
    },
    'reason': {
      'type': 'string',
      'description': 'Why you need this lock (optional, for acquire)',
    },
  },
  'required': ['action'],
};

/// Tool config for lock.
const lockToolConfig = (
  title: 'File Lock',
  description:
      'Manage file locks. You must register first. '
      'REQUIRED: action (acquire|release|force_release|renew|query|list). '
      'For acquire/release/renew: file_path. For query: file_path. '
      'Example: {"action":"acquire","file_path":"/path/file.dart",'
      ' "reason":"editing"}',
  inputSchema: lockInputSchema,
  outputSchema: null,
  annotations: null,
);

/// Create lock tool handler.
ToolCallback createLockHandler(
  TooManyCooksDb db,
  TooManyCooksConfig config,
  NotificationEmitter emitter,
  Logger logger,
  SessionGetter getSession,
) => (args, meta) async {
  final actionArg = args['action'];
  if (actionArg == null || actionArg is! String) {
    return (
      content: <Object>[
        textContent(
          jsonEncode({'error': 'missing_parameter: action is required'}),
        ),
      ],
      isError: true,
    );
  }
  final action = actionArg;
  final filePath = switch (args['file_path']) {
    final String v => v,
    _ => null,
  };
  final reason = switch (args['reason']) {
    final String v => v,
    _ => null,
  };
  final log = logger.child({
    'tool': 'lock',
    'action': action,
    'filePath': ?filePath,
  });

  // query and list don't need auth
  if (action == 'query') return _query(db, filePath);
  if (action == 'list') return _list(db);

  // Hidden agent_key override for multi-agent integration testing
  final keyOverride = switch (args['agent_key']) {
    final String v => v,
    _ => null,
  };
  final String agentName;
  final String agentKey;
  if (keyOverride != null) {
    agentKey = keyOverride;
    switch (db.lookupByKey(keyOverride)) {
      case Success(:final value):
        agentName = value;
      case Error(:final error):
        return _errorResult(error);
    }
  } else {
    final session = getSession();
    if (session == null) {
      return (
        content: <Object>[
          textContent(
            jsonEncode({'error': 'not_registered: call register first'}),
          ),
        ],
        isError: true,
      );
    }
    agentName = session.agentName;
    agentKey = session.agentKey;
  }

  return switch (action) {
    'acquire' => _acquire(
      db,
      emitter,
      log,
      filePath,
      agentName,
      agentKey,
      reason,
      config.lockTimeoutMs,
    ),
    'release' => _release(db, emitter, log, filePath, agentName, agentKey),
    'force_release' => _forceRelease(
      db,
      emitter,
      log,
      filePath,
      agentName,
      agentKey,
    ),
    'renew' => _renew(
      db,
      emitter,
      log,
      filePath,
      agentName,
      agentKey,
      config.lockTimeoutMs,
    ),
    _ => (
      content: <Object>[
        textContent(jsonEncode({'error': 'Unknown action: $action'})),
      ],
      isError: true,
    ),
  };
};

CallToolResult _acquire(
  TooManyCooksDb db,
  NotificationEmitter emitter,
  Logger log,
  String? filePath,
  String agentName,
  String agentKey,
  String? reason,
  int timeoutMs,
) {
  if (filePath == null) {
    return (
      content: <Object>[
        textContent(jsonEncode({'error': 'acquire requires file_path'})),
      ],
      isError: true,
    );
  }
  final result = db.acquireLock(
    filePath,
    agentName,
    agentKey,
    reason,
    timeoutMs,
  );
  return switch (result) {
    Success(:final value) when value.acquired => () {
      emitter.emit(eventLockAcquired, {
        'file_path': filePath,
        'agent_name': agentName,
        'expires_at': value.lock?.expiresAt,
        'reason': reason,
      });
      log.info('Lock acquired on $filePath by $agentName');
      return (
        content: <Object>[textContent(jsonEncode(lockResultToJson(value)))],
        isError: false,
      );
    }(),
    Success(:final value) => (
      content: <Object>[textContent(jsonEncode(lockResultToJson(value)))],
      isError: true,
    ),
    Error(:final error) => _errorResult(error),
  };
}

CallToolResult _release(
  TooManyCooksDb db,
  NotificationEmitter emitter,
  Logger log,
  String? filePath,
  String agentName,
  String agentKey,
) {
  if (filePath == null) {
    return (
      content: <Object>[
        textContent(jsonEncode({'error': 'release requires file_path'})),
      ],
      isError: true,
    );
  }
  return switch (db.releaseLock(filePath, agentName, agentKey)) {
    Success() => () {
      emitter.emit(eventLockReleased, {
        'file_path': filePath,
        'agent_name': agentName,
      });
      log.info('Lock released on $filePath by $agentName');
      return (
        content: <Object>[
          textContent(jsonEncode({'released': true})),
        ],
        isError: false,
      );
    }(),
    Error(:final error) => _errorResult(error),
  };
}

CallToolResult _forceRelease(
  TooManyCooksDb db,
  NotificationEmitter emitter,
  Logger log,
  String? filePath,
  String agentName,
  String agentKey,
) {
  if (filePath == null) {
    return (
      content: <Object>[
        textContent(jsonEncode({'error': 'force_release requires file_path'})),
      ],
      isError: true,
    );
  }
  return switch (db.forceReleaseLock(filePath, agentName, agentKey)) {
    Success() => () {
      emitter.emit(eventLockReleased, {
        'file_path': filePath,
        'agent_name': agentName,
        'force': true,
      });
      log.warn('Lock force-released on $filePath by $agentName');
      return (
        content: <Object>[
          textContent(jsonEncode({'released': true})),
        ],
        isError: false,
      );
    }(),
    Error(:final error) => (
      content: <Object>[
        textContent(jsonEncode({'error': error.message})),
      ],
      isError: true,
    ),
  };
}

CallToolResult _renew(
  TooManyCooksDb db,
  NotificationEmitter emitter,
  Logger log,
  String? filePath,
  String agentName,
  String agentKey,
  int timeoutMs,
) {
  if (filePath == null) {
    return (
      content: <Object>[
        textContent(jsonEncode({'error': 'renew requires file_path'})),
      ],
      isError: true,
    );
  }
  return switch (db.renewLock(filePath, agentName, agentKey, timeoutMs)) {
    Success() => () {
      final newExpiresAt = DateTime.now().millisecondsSinceEpoch + timeoutMs;
      emitter.emit(eventLockRenewed, {
        'file_path': filePath,
        'agent_name': agentName,
        'expires_at': newExpiresAt,
      });
      log.debug('Lock renewed on $filePath by $agentName');
      return (
        content: <Object>[
          textContent(jsonEncode({'renewed': true})),
        ],
        isError: false,
      );
    }(),
    Error(:final error) => _errorResult(error),
  };
}

CallToolResult _query(TooManyCooksDb db, String? filePath) {
  if (filePath == null) {
    return (
      content: <Object>[
        textContent(jsonEncode({'error': 'query requires file_path'})),
      ],
      isError: true,
    );
  }
  return switch (db.queryLock(filePath)) {
    Success(value: final FileLock v) => (
      content: <Object>[
        textContent(jsonEncode({'locked': true, 'lock': fileLockToJson(v)})),
      ],
      isError: false,
    ),
    Success() => (
      content: <Object>[
        textContent(jsonEncode({'locked': false})),
      ],
      isError: false,
    ),
    Error(:final error) => _errorResult(error),
  };
}

CallToolResult _list(TooManyCooksDb db) => switch (db.listLocks()) {
  Success(:final value) => (
    content: <Object>[
      textContent(jsonEncode({'locks': value.map(fileLockToJson).toList()})),
    ],
    isError: false,
  ),
  Error(:final error) => _errorResult(error),
};

CallToolResult _errorResult(DbError e) => (
  content: <Object>[textContent(jsonEncode(dbErrorToJson(e)))],
  isError: true,
);
