/// Status tool - system overview.
library;

import 'dart:convert' show jsonEncode;

import 'package:dart_logging/dart_logging.dart';
import 'package:dart_node_mcp/dart_node_mcp.dart';
import 'package:nadz/nadz.dart';
import 'package:too_many_cooks/src/data/data.dart';
import 'package:too_many_cooks/src/types.dart';

/// Input schema for status tool (no inputs required).
const statusInputSchema = <String, Object?>{
  'type': 'object',
  'properties': <String, Object?>{},
};

/// Tool config for status.
const statusToolConfig = (
  title: 'Status',
  description: 'Get system overview: agents, locks, plans, messages',
  inputSchema: statusInputSchema,
  outputSchema: null,
  annotations: null,
);

/// Create status tool handler.
ToolCallback createStatusHandler(TooManyCooksDb db, Logger logger) =>
    (args, meta) async {
      final log = logger.child({'tool': 'status'});

      final List<Map<String, Object?>> agents;
      switch (db.listAgents()) {
        case Success(:final value):
          agents = value.map(agentIdentityToJson).toList();
        case Error(:final error):
          return _errorResult(error);
      }

      final List<Map<String, Object?>> locks;
      switch (db.listLocks()) {
        case Success(:final value):
          locks = value.map(fileLockToJson).toList();
        case Error(:final error):
          return _errorResult(error);
      }

      final List<Map<String, Object?>> plans;
      switch (db.listPlans()) {
        case Success(:final value):
          plans = value.map(agentPlanToJson).toList();
        case Error(:final error):
          return _errorResult(error);
      }

      final List<Map<String, Object?>> messages;
      switch (db.listAllMessages()) {
        case Success(:final value):
          messages = value.map(messageToJson).toList();
        case Error(:final error):
          return _errorResult(error);
      }

      log.debug('Status queried');

      return (
        content: <Object>[
          textContent(
            jsonEncode({
              'agents': agents,
              'locks': locks,
              'plans': plans,
              'messages': messages,
            }),
          ),
        ],
        isError: false,
      );
    };

CallToolResult _errorResult(DbError e) => (
  content: <Object>[textContent(jsonEncode(dbErrorToJson(e)))],
  isError: true,
);
