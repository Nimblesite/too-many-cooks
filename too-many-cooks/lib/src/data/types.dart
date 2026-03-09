/// Core types for Too Many Cooks data layer.
library;

// Re-export generated model types and serializers.
export 'package:too_many_cooks/src/data/types.gen.dart';

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
