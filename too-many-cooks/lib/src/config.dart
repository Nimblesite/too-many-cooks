/// Configuration for Too Many Cooks MCP server.
///
/// Database path resolution
/// lives in the data package to guarantee a single source of truth.
library;

import 'package:too_many_cooks/src/data/data.dart' show TooManyCooksDataConfig;

export 'package:too_many_cooks/src/data/data.dart'
    show
        TooManyCooksDataConfig,
        createDataConfig,
        createDataConfigFromWorkspace,
        defaultConfig,
        defaultPort,
        getServerPort,
        getWorkspaceFolder,
        resolveDbPath;

/// Server configuration type alias for backwards compatibility.
typedef TooManyCooksConfig = TooManyCooksDataConfig;

/// Server binary relative path (output of build_mcp.sh).
const serverBinary = 'build/bin/server_node.js';
