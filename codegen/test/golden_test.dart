/// E2E golden test: parse TMC schema -> emit Dart + TS -> compare snapshots.
library;

import 'dart:io';

import 'package:nadz/nadz.dart';
import 'package:test/test.dart';
import 'package:tmc_codegen/src/dart_emitter.dart';
import 'package:tmc_codegen/src/schema_parser.dart';
import 'package:tmc_codegen/src/ts_emitter.dart';
import 'package:tmc_codegen/src/types.dart';

/// Path to the TMC schema file.
const _schemaPath = '../too-many-cooks/schema/models.json';

/// Path to the Dart golden file.
const _dartGoldenPath = 'test/goldens/models.dart.golden';

/// Path to the TypeScript golden file.
const _tsGoldenPath = 'test/goldens/models.ts.golden';

/// Update flag env var name.
const _updateGoldensEnv = 'UPDATE_GOLDENS';

Schema _parseSchemaFile() {
  final result = parseSchemaFile(_schemaPath);
  return switch (result) {
    Success(:final Schema value) => value,
    Error(:final error) => throw StateError('parse failed: $error'),
  };
}

String _readGolden(String path) => File(path).readAsStringSync();

void _writeGolden(String path, String content) {
  File(path).writeAsStringSync(content);
}

bool _shouldUpdate() =>
    Platform.environment[_updateGoldensEnv]?.toLowerCase() == 'true';

void main() {
  test('Dart output matches golden snapshot', () {
    final schema = _parseSchemaFile();
    final actual = emitDart(schema);

    if (_shouldUpdate()) {
      _writeGolden(_dartGoldenPath, actual);
      return;
    }

    final expected = _readGolden(_dartGoldenPath);
    expect(actual, expected);
  });

  test('TypeScript output matches golden snapshot', () {
    final schema = _parseSchemaFile();
    final actual = emitTypeScript(schema);

    if (_shouldUpdate()) {
      _writeGolden(_tsGoldenPath, actual);
      return;
    }

    final expected = _readGolden(_tsGoldenPath);
    expect(actual, expected);
  });
}
