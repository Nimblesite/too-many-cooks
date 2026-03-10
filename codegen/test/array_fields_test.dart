/// E2E: schema with array fields -> List/readonly array types.
library;

import 'package:test/test.dart';
import 'package:tmc_codegen/src/dart_emitter.dart';
import 'package:tmc_codegen/src/ts_emitter.dart';

import 'test_helpers.dart';

const _schema = '''
{
  "models": {
    "Tags": {
      "properties": {
        "values": { "type": "array", "items": { "type": "string" } },
        "counts": { "type": "array", "items": { "type": "integer" } }
      },
      "required": ["values", "counts"]
    }
  }
}
''';

void main() {
  test('Dart emits List types for arrays', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('List<String> values,'));
    expect(dart, contains('List<int> counts,'));
  });

  test('Dart fromJson filters array elements by type', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('whereType<String>()'));
    expect(dart, contains('whereType<int>()'));
  });

  test('TS emits readonly array types', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains('readonly values: readonly string[]'));
    expect(ts, contains('readonly counts: readonly number[]'));
  });
}
