/// E2E: schema with nullable fields -> correct optional types.
library;

import 'package:test/test.dart';
import 'package:tmc_codegen/src/dart_emitter.dart';
import 'package:tmc_codegen/src/ts_emitter.dart';

import 'test_helpers.dart';

const _schema = '''
{
  "models": {
    "Item": {
      "properties": {
        "id": { "type": "integer" },
        "label": { "type": "string" },
        "score": { "type": "number" }
      },
      "required": ["id"]
    }
  }
}
''';

void main() {
  test('Dart nullable fields get question mark', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('int id,'));
    expect(dart, contains('String? label,'));
    expect(dart, contains('double? score,'));
  });

  test('Dart toJson wraps nullable fields in null check', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('item.label != null'));
    expect(dart, contains('item.score != null'));
  });

  test('Dart fromJson returns null for nullable fields', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('_ => null'));
  });

  test('TS nullable fields use union with null', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains('readonly label: string | null'));
    expect(ts, contains('readonly score: number | null'));
  });

  test('TS parser uses nullable helpers for optional fields', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains("nullableStringField(raw, 'label')"));
    expect(ts, contains("nullableNumberField(raw, 'score')"));
  });
}
