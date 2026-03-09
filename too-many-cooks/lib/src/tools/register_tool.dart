/// Register tool - agent registration and reconnection.
library;

import 'dart:convert' show jsonEncode;

import 'package:dart_logging/dart_logging.dart';
import 'package:dart_node_mcp/dart_node_mcp.dart';
import 'package:nadz/nadz.dart';
import 'package:too_many_cooks/src/data/data.dart';
import 'package:too_many_cooks/src/notifications.dart';
import 'package:too_many_cooks/src/types.dart';

/// Input schema for register tool.
const registerInputSchema = <String, Object?>{
  'type': 'object',
  'properties': {
    'name': {
      'type': 'string',
      'description':
          'Your unique agent name, 1-50 chars. '
          'For FIRST registration only. Do NOT send with key.',
    },
    'key': {
      'type': 'string',
      'description':
          'Your secret key from a previous registration. '
          'For RECONNECT only. Do NOT send with name.',
    },
  },
};

/// Tool config for register.
const registerToolConfig = (
  title: 'Register Agent',
  description:
      'Register a new agent or reconnect with an existing key. '
      'FIRST TIME: pass "name" only. Returns key — store it! '
      'RECONNECT: pass "key" only. Server looks up your name. '
      'Passing both name and key is an error. '
      'Example first: {"name": "my-agent"} '
      'Example reconnect: {"key": "abc123..."}',
  inputSchema: registerInputSchema,
  outputSchema: null,
  annotations: null,
);

/// Create register tool handler.
ToolCallback createRegisterHandler(
  TooManyCooksDb db,
  NotificationEmitter emitter,
  Logger logger,
  SessionSetter setSession,
) => (args, meta) async {
  final nameArg = switch (args['name']) {
    final String v => v,
    _ => null,
  };
  final keyArg = switch (args['key']) {
    final String v => v,
    _ => null,
  };
  final hasName = nameArg != null && nameArg.isNotEmpty;
  final hasKey = keyArg != null && keyArg.isNotEmpty;

  // Both = error, neither = error
  if (hasName && hasKey) {
    return (
      content: <Object>[
        textContent(
          jsonEncode({'error': 'validation: pass name OR key, not both'}),
        ),
      ],
      isError: true,
    );
  }
  if (!hasName && !hasKey) {
    return (
      content: <Object>[
        textContent(
          jsonEncode({'error': 'missing_parameter: name or key required'}),
        ),
      ],
      isError: true,
    );
  }

  // Reconnect path: key only
  if (hasKey) {
    final log = logger.child({'tool': 'register', 'mode': 'reconnect'});
    return switch (db.lookupByKey(keyArg)) {
      Success(:final value) => () {
        setSession(value, keyArg);
        db.activate(value);
        emitter.emit(eventAgentActivated, {'agent_name': value});
        log.info('Agent reconnected: $value');
        return (
          content: <Object>[
            textContent(jsonEncode({'agent_name': value, 'agent_key': keyArg})),
          ],
          isError: false,
        );
      }(),
      Error(:final error) => () {
        log.warn('Reconnect failed: ${error.code}');
        return (
          content: <Object>[textContent(jsonEncode(dbErrorToJson(error)))],
          isError: true,
        );
      }(),
    };
  }

  // First registration: name only
  switch (nameArg) {
    case final String name:
      final log = logger.child({'tool': 'register', 'agentName': name});
      final regResult = db.register(name);
      final AgentRegistration reg;
      switch (regResult) {
        case Success(:final value):
          reg = value;
        case Error(:final error)
            when error.message.contains('already registered'):
          // Re-registration: reset key so agent gets a fresh identity
          switch (db.adminResetKey(name)) {
            case Success(:final value):
              reg = value;
            case Error(:final error):
              log.warn('Re-registration failed: ${error.code}');
              return (
                content: <Object>[
                  textContent(jsonEncode(dbErrorToJson(error))),
                ],
                isError: true,
              );
          }
        case Error(:final error):
          log.warn('Registration failed: ${error.code}');
          return (
            content: <Object>[textContent(jsonEncode(dbErrorToJson(error)))],
            isError: true,
          );
      }
      setSession(reg.agentName, reg.agentKey);
      db.activate(reg.agentName);
      emitter.emit(eventAgentRegistered, {
        'agent_name': reg.agentName,
        'registered_at': DateTime.now().millisecondsSinceEpoch,
      });
      log.info('Agent registered: ${reg.agentName}');
      return (
        content: <Object>[
          textContent(jsonEncode(agentRegistrationToJson(reg))),
        ],
        isError: false,
      );
    default:
      return (
        content: <Object>[
          textContent(
            jsonEncode({'error': 'missing_parameter: name required'}),
          ),
        ],
        isError: true,
      );
  }
};
