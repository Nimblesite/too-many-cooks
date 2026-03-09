/// Core types for Too Many Cooks data layer.
library;

import 'package:nadz/nadz.dart';
import 'package:too_many_cooks/src/data/types.gen.dart';

// Re-export generated model types and serializers.
export 'package:too_many_cooks/src/data/types.gen.dart';

/// Pattern for valid agent names: alphanumeric, hyphens, underscores.
final _validAgentName = RegExp(r'^[a-zA-Z0-9_-]+$');

/// Maximum agent name length.
const maxAgentNameLength = 50;

/// Create a validated AgentIdentity.
Result<AgentIdentity, DbError> agentIdentity({
  required String agentName,
  required int registeredAt,
  required int lastActive,
}) =>
    !_validAgentName.hasMatch(agentName)
        ? const Error((
            code: errValidation,
            message: 'Agent name must be alphanumeric (hyphens/underscores ok)',
          ))
        : agentName.length > maxAgentNameLength
            ? const Error((
                code: errValidation,
                message: 'Agent name must be 1-50 chars',
              ))
            : Success((
                agentName: agentName,
                registeredAt: registeredAt,
                lastActive: lastActive,
              ));

/// Error code for resource not found.
const errNotFound = 'NOT_FOUND';

/// Error code for unauthorized access.
const errUnauthorized = 'UNAUTHORIZED';

/// Error code when lock is held by another agent.
const errLockHeld = 'LOCK_HELD';

/// Error code when lock has expired.
const errLockExpired = 'LOCK_EXPIRED';

/// Error code for validation failures.
const errValidation = 'VALIDATION';

/// Error code for database errors.
const errDatabase = 'DATABASE';
