/// Shared test helpers for codegen e2e tests.
library;

import 'package:nadz/nadz.dart';
import 'package:tmc_codegen/src/schema_parser.dart';
import 'package:tmc_codegen/src/types.dart';

/// Parse a JSON schema string, failing the test if parsing fails.
Schema parseOrFail(String json) => switch (parseSchemaJson(json)) {
  Success(:final Schema value) => value,
  Error(:final error) => throw StateError('parse failed: $error'),
};
