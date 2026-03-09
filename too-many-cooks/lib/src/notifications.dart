/// Notification system for push-based updates.
///
/// All events are pushed automatically to every connected client
/// (agents + VSIX). There is no subscribe tool — subscriptions
/// are managed entirely by the server based on connection state.
///
/// Agents receive notifications via MCP logging messages on their
/// Streamable HTTP session. This is CRITICAL — agents must know
/// about new messages, lock changes, and agent status in
/// real-time without polling.
library;

import 'dart:async';

import 'package:dart_node_core/dart_node_core.dart';
import 'package:dart_node_mcp/dart_node_mcp.dart';
import 'package:nadz/nadz.dart';

/// Event type for agent registration.
const eventAgentRegistered = 'agent_registered';

/// Event type for agent activation (reconnect).
const eventAgentActivated = 'agent_activated';

/// Event type for agent deactivation (disconnect).
const eventAgentDeactivated = 'agent_deactivated';

/// Event type for lock acquisition.
const eventLockAcquired = 'lock_acquired';

/// Event type for lock release.
const eventLockReleased = 'lock_released';

/// Event type for lock renewal.
const eventLockRenewed = 'lock_renewed';

/// Event type for message sent.
const eventMessageSent = 'message_sent';

/// Event type for plan update.
const eventPlanUpdated = 'plan_updated';

/// Logger name for agent notifications.
const agentLoggerName = 'too-many-cooks';

/// Broadcast recipient sentinel.
const broadcastRecipient = '*';

/// Callback type for pushing events to all agents.
typedef EventPushFn = void Function(String event, Map<String, Object?> payload);

/// Callback type for pushing events to a specific agent by name
/// or '*' for all.
typedef EventPushToAgentFn =
    void Function(String event, Map<String, Object?> payload, String toAgent);

/// Agent event hub — tracks all connected agent McpServer
/// instances and pushes notifications to them in real-time.
///
/// Only sessions with an active SSE GET stream receive pushes.
/// This prevents buffered notifications from being delivered
/// when the SSE stream first opens.
typedef AgentEventHub = ({
  Map<String, McpServer> servers,

  /// sessionId → agentName, populated on register.
  Map<String, String> sessionAgentNames,

  /// Sessions with an active SSE GET stream.
  Set<String> activeSseSessions,
  EventPushFn pushEvent,
  EventPushToAgentFn pushToAgent,
});

/// Send a logging message to an MCP server session.
Future<Result<void, String>> sendNotification(
  McpServer server,
  Map<String, Object?> data,
) async {
  try {
    await server.sendLoggingMessage((
      level: 'info',
      logger: agentLoggerName,
      data: data,
    ));
    return const Success(null);
  } on Object catch (e) {
    return Error('$e');
  }
}

/// Create an agent event hub.
AgentEventHub createAgentEventHub() {
  final servers = <String, McpServer>{};
  final sessionAgentNames = <String, String>{};
  final activeSseSessions = <String>{};

  Future<void> send(
    String sessionId,
    McpServer server,
    Map<String, Object?> data,
  ) async {
    if (!activeSseSessions.contains(sessionId)) return;
    consoleError('[TMC] [AGENT-PUSH] Sending to $sessionId');
    switch (await sendNotification(server, data)) {
      case Success():
        consoleError('[TMC] [AGENT-PUSH] Sent OK to $sessionId');
      case Error(:final error):
        consoleError('[TMC] [AGENT-PUSH] FAILED $sessionId: $error');
        servers.remove(sessionId);
        sessionAgentNames.remove(sessionId);
        activeSseSessions.remove(sessionId);
    }
  }

  void pushEvent(String event, Map<String, Object?> payload) {
    consoleError('[TMC] [AGENT-PUSH] $event → ${servers.length} agent(s)');
    final data = <String, Object?>{
      'event': event,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'payload': payload,
    };
    for (final entry in [...servers.entries]) {
      unawaited(send(entry.key, entry.value, data));
    }
  }

  void pushToAgent(String event, Map<String, Object?> payload, String toAgent) {
    final data = <String, Object?>{
      'event': event,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'payload': payload,
    };
    if (toAgent == broadcastRecipient) {
      consoleError(
        '[TMC] [AGENT-PUSH] $event (broadcast) → '
        '${servers.length} agent(s)',
      );
      for (final entry in [...servers.entries]) {
        unawaited(send(entry.key, entry.value, data));
      }
    } else {
      for (final entry in [...sessionAgentNames.entries]) {
        if (entry.value == toAgent) {
          final server = servers[entry.key];
          if (server != null) {
            unawaited(send(entry.key, server, data));
          }
        }
      }
    }
  }

  return (
    servers: servers,
    sessionAgentNames: sessionAgentNames,
    activeSseSessions: activeSseSessions,
    pushEvent: pushEvent,
    pushToAgent: pushToAgent,
  );
}

/// Notification emitter — pushes events to agents and admin.
typedef NotificationEmitter = ({
  void Function(String event, Map<String, Object?> payload) emit,

  /// Push only to admin (VSIX), not to agents.
  void Function(String event, Map<String, Object?> payload) emitAdmin,

  /// Push only to a specific agent by name, or '*' for all.
  void Function(String event, Map<String, Object?> payload, String toAgent)
  emitToAgent,
});

/// Create a notification emitter that pushes to both the
/// agent event hub and the admin event hub.
///
/// Pushes are synchronous — MCP notifications travel over the
/// SSE GET stream, not the POST response, so there is no need
/// to defer them.
NotificationEmitter createNotificationEmitter(
  McpServer server, {
  EventPushFn? adminPush,
  EventPushFn? agentPush,
  EventPushToAgentFn? agentPushToAgent,
}) {
  void emit(String event, Map<String, Object?> payload) {
    adminPush?.call(event, payload);
    agentPush?.call(event, payload);
  }

  void emitAdmin(String event, Map<String, Object?> payload) {
    adminPush?.call(event, payload);
  }

  void emitToAgent(String event, Map<String, Object?> payload, String toAgent) {
    adminPush?.call(event, payload);
    agentPushToAgent?.call(event, payload, toAgent);
  }

  return (emit: emit, emitAdmin: emitAdmin, emitToAgent: emitToAgent);
}
