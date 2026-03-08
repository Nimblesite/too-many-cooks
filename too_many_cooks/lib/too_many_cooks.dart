/// Multi-agent Git coordination MCP server.
///
/// Enables multiple AI agents to safely edit a git repository simultaneously
/// through advisory file locking, identity verification, inter-agent messaging,
/// and plan visibility.
library;

export 'src/admin_routes.dart';
export 'src/config.dart';
export 'src/data/data.dart'
    show TooManyCooksDb, createDb;
export 'src/server.dart';
export 'src/types.dart';
