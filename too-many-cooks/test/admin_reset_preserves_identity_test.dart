/// Test: /admin/reset MUST preserve agent identities.
///
/// BUG: /admin/reset does DELETE FROM identity, which nukes
/// all agent registrations. After reset, agents cannot
/// reconnect with their saved keys and must re-register —
/// creating duplicate identities and polluting the agent list.
///
/// Reset should clear transient data (locks, messages, plans)
/// but preserve agent identities so agents can reconnect.
library;

import 'dart:js_interop';

import 'package:dart_node_core/dart_node_core.dart';
import 'package:nadz/nadz.dart';
import 'package:test/test.dart';
import 'package:too_many_cooks/src/data/data.dart';

extension type _Fs(JSObject _) implements JSObject {
  external void unlinkSync(String path);
  external bool existsSync(String path);
}

final _Fs _fs = _Fs(requireModule('fs') as JSObject);

void _deleteIfExists(String path) {
  try {
    if (_fs.existsSync(path)) {
      _fs.unlinkSync(path);
    }
  } on Object catch (_) {}
}

const _testDbPath = '.test_admin_reset_identity.db';

void main() {
  TooManyCooksDb? db;

  setUp(() {
    _deleteIfExists(_testDbPath);
    final config = createDataConfig(dbPath: _testDbPath);
    final result = createDb(config);
    expect(result, isA<Success<TooManyCooksDb, String>>());
    db = (result as Success<TooManyCooksDb, String>).value;
  });

  tearDown(() {
    db?.close();
    _deleteIfExists(_testDbPath);
  });

  test('agent can reconnect with saved key after adminReset', () {
    // 1. Register an agent and save the key
    final regResult = db!.register('persistent-agent');
    expect(regResult, isA<Success<AgentRegistration, DbError>>());
    final reg = (regResult as Success<AgentRegistration, DbError>).value;
    expect(reg.agentKey.length, 64);

    // 2. Call adminReset (should clear transient data)
    final resetResult = db!.adminReset();
    expect(resetResult, isA<Success<void, DbError>>());

    // 3. Try to reconnect with the saved key
    final lookupResult = db!.lookupByKey(reg.agentKey);

    // 4. ASSERT: reconnection MUST succeed
    expect(
      lookupResult,
      isA<Success<String, DbError>>(),
      reason:
          'Agent MUST be able to reconnect with saved key '
          'after adminReset. Reset should clear locks, '
          'messages, and plans — NOT agent identities.',
    );
    final name = (lookupResult as Success<String, DbError>).value;
    expect(name, equals('persistent-agent'));
  });

  test('adminReset clears locks and plans', () {
    // Register and create transient data
    final regResult = db!.register('transient-agent');
    final reg = (regResult as Success<AgentRegistration, DbError>).value;
    db!.activate('transient-agent');
    db!.acquireLock(
      'test.dart',
      reg.agentName,
      reg.agentKey,
      'testing',
      600000,
    );
    db!.updatePlan(reg.agentName, reg.agentKey, 'test goal', 'test task');

    // Reset
    db!.adminReset();

    // Locks and plans should be empty
    final locksResult = db!.listLocks();
    expect(locksResult, isA<Success<List<FileLock>, DbError>>());
    final locks = (locksResult as Success<List<FileLock>, DbError>).value;
    expect(locks, isEmpty, reason: 'Locks must be cleared after adminReset');

    final plansResult = db!.listPlans();
    expect(plansResult, isA<Success<List<AgentPlan>, DbError>>());
    final plans = (plansResult as Success<List<AgentPlan>, DbError>).value;
    expect(plans, isEmpty, reason: 'Plans must be cleared after adminReset');
  });
}
