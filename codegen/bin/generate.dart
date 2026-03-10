/// CLI entry point: JSON Schema -> Dart records + TypeScript interfaces.
library;

import 'dart:io';

import 'package:nadz/nadz.dart';
import 'package:tmc_codegen/src/dart_emitter.dart';
import 'package:tmc_codegen/src/schema_parser.dart';
import 'package:tmc_codegen/src/ts_emitter.dart';

/// Minimum required argument count.
const _minArgs = 3;

/// Exit code for usage errors.
const _exitUsage = 64;

/// Exit code for input errors.
const _exitInput = 65;

void main(List<String> args) {
  if (args.length < _minArgs) {
    _printUsage();
    exit(_exitUsage);
  }

  final schemaPath = args[0];
  final dartOutPath = args[1];
  final tsOutPath = args[2];

  switch (parseSchemaFile(schemaPath)) {
    case Success(:final value):
      _writeOutput(dartOutPath, emitDart(value));
      _writeOutput(tsOutPath, emitTypeScript(value));
      stdout.writeln('Generated:');
      stdout.writeln('  Dart: $dartOutPath');
      stdout.writeln('  TypeScript: $tsOutPath');
    case Error(:final error):
      stderr.writeln('Error: $error');
      exit(_exitInput);
  }
}

void _writeOutput(String path, String content) {
  File(path).writeAsStringSync(content);
}

void _printUsage() {
  stderr.writeln(
    'Usage: dart run bin/generate.dart '
    '<schema.json> <output.dart> <output.ts>',
  );
}
