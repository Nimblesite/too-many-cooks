/// E2E: schema with $ref fields -> nested model references.
library;

import 'package:test/test.dart';
import 'package:tmc_codegen/src/dart_emitter.dart';
import 'package:tmc_codegen/src/ts_emitter.dart';

import 'test_helpers.dart';

const _schema = r'''
{
  "models": {
    "Address": {
      "properties": {
        "street": { "type": "string" },
        "city": { "type": "string" }
      },
      "required": ["street", "city"]
    },
    "Person": {
      "properties": {
        "name": { "type": "string" },
        "home": { "$ref": "Address" }
      },
      "required": ["name"]
    }
  }
}
''';

void main() {
  test('Dart emits ref type for nested model', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('Address? home,'));
  });

  test('Dart toJson calls nested toJson', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('addressToJson('));
  });

  test('Dart fromJson calls nested fromJson', () {
    final dart = emitDart(parseOrFail(_schema));
    expect(dart, contains('addressFromJson(v)'));
  });

  test('TS emits ref type for nested model', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains('readonly home: Address | null'));
  });

  test('TS parser calls nested parse function', () {
    final ts = emitTypeScript(parseOrFail(_schema));
    expect(ts, contains('parseAddress('));
  });
}
