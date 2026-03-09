/// E2E: schema with string fields -> Dart records + TS interfaces.
library;

import 'package:test/test.dart';
import 'package:tmc_codegen/src/dart_emitter.dart';
import 'package:tmc_codegen/src/ts_emitter.dart';

import 'test_helpers.dart';

const _schema = '''
{
  "models": {
    "User": {
      "description": "A user record.",
      "properties": {
        "name": { "type": "string" },
        "email": { "type": "string" }
      },
      "required": ["name", "email"]
    }
  }
}
''';

void main() {
  test('parses string-only schema', () {
    final schema = parseOrFail(_schema);
    expect(schema.models.length, 1);
    expect(schema.models[0].name, 'User');
    expect(schema.models[0].fields.length, 2);
  });

  test('emits Dart typedef with string fields', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('typedef User = ('));
    expect(dart, contains('String name'));
    expect(dart, contains('String email'));
  });

  test('emits Dart toJson for string fields', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('String userToJson(User user)'));
  });

  test('emits Dart fromJson for string fields', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('User userFromJson(Map<String, Object?> json)'));
    expect(dart, contains("json['name']"));
    expect(dart, contains("json['email']"));
  });

  test('emits TS interface with string fields', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains('export interface User'));
    expect(ts, contains('readonly name: string'));
    expect(ts, contains('readonly email: string'));
  });

  test('emits TS parser for string fields', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains('export function parseUser'));
    expect(ts, contains("stringField(raw, 'name')"));
    expect(ts, contains("stringField(raw, 'email')"));
  });
}
