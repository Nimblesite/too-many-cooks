/// E2E: invalid schemas produce parse errors.
library;

import 'package:nadz/nadz.dart';
import 'package:test/test.dart';
import 'package:tmc_codegen/src/schema_parser.dart';
import 'package:tmc_codegen/src/types.dart';

void main() {
  test('rejects invalid JSON', () {
    final result = parseSchemaJson('not json');
    expect(result, isA<Error<Schema, String>>());
  });

  test('rejects missing models key', () {
    final result = parseSchemaJson('{"foo": 1}');
    expect(result, isA<Error<Schema, String>>());
  });

  test('rejects model without properties', () {
    final result = parseSchemaJson('{"models": {"X": {}}}');
    expect(result, isA<Error<Schema, String>>());
  });

  test('rejects unknown field type', () {
    final result = parseSchemaJson('''
{
  "models": {
    "X": {
      "properties": {
        "f": { "type": "banana" }
      },
      "required": ["f"]
    }
  }
}
''');
    expect(result, isA<Error<Schema, String>>());
  });

  test('rejects array without items', () {
    final result = parseSchemaJson('''
{
  "models": {
    "X": {
      "properties": {
        "f": { "type": "array" }
      },
      "required": ["f"]
    }
  }
}
''');
    expect(result, isA<Error<Schema, String>>());
  });
}
