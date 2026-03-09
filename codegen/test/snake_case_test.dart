/// E2E: camelCase field names -> snake_case JSON keys.
library;

import 'package:test/test.dart';
import 'package:tmc_codegen/src/dart_emitter.dart';
import 'package:tmc_codegen/src/ts_emitter.dart';

import 'test_helpers.dart';

const _schema = '''
{
  "models": {
    "Event": {
      "properties": {
        "eventName": { "type": "string" },
        "createdAt": { "type": "integer" },
        "isActive": { "type": "boolean" }
      },
      "required": ["eventName", "createdAt", "isActive"]
    }
  }
}
''';

void main() {
  test('Dart toJson uses snake_case keys', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('"event_name"'));
    expect(dart, contains('"created_at"'));
    expect(dart, contains('"is_active"'));
  });

  test('Dart fromJson reads snake_case keys', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains("json['event_name']"));
    expect(dart, contains("json['created_at']"));
    expect(dart, contains("json['is_active']"));
  });

  test('TS parser reads snake_case keys', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains("'event_name'"));
    expect(ts, contains("'created_at'"));
    expect(ts, contains("'is_active'"));
  });
}
