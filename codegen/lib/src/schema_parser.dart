/// Parse JSON Schema model definitions into internal model.
library;

import 'dart:convert';
import 'dart:io';

import 'package:nadz/nadz.dart';

import 'package:tmc_codegen/src/types.dart';

/// Key for the models map in the schema JSON.
const _modelsKey = 'models';

/// Key for properties in a JSON Schema object.
const _propertiesKey = 'properties';

/// Key for required fields in a JSON Schema object.
const _requiredKey = 'required';

/// Key for description in a JSON Schema object.
const _descriptionKey = 'description';

/// Read and parse a schema JSON file into a Schema.
Result<Schema, String> parseSchemaFile(String path) {
  final file = File(path);
  if (!file.existsSync()) return Error('schema file not found: $path');

  final String contents;
  try {
    contents = file.readAsStringSync();
  } on FileSystemException catch (e) {
    return Error('failed to read schema: ${e.message}');
  }

  return parseSchemaJson(contents);
}

/// Parse a JSON string into a Schema.
Result<Schema, String> parseSchemaJson(String json) {
  final Object? decoded;
  try {
    decoded = jsonDecode(json);
  } on FormatException catch (e) {
    return Error('invalid JSON: ${e.message}');
  }

  if (decoded is! Map<String, Object?>) {
    return const Error('schema root must be a JSON object');
  }

  return _parseModels(decoded);
}

Result<Schema, String> _parseModels(Map<String, Object?> root) {
  final models = root[_modelsKey];
  if (models is! Map<String, Object?>) {
    return const Error('schema must contain a "models" object');
  }

  final parsed = <ModelDef>[];
  for (final entry in models.entries) {
    switch (_parseModel(entry.key, entry.value)) {
      case Success(:final value):
        parsed.add(value);
      case Error(:final error):
        return Error(error);
    }
  }

  return Success((models: parsed));
}

Result<ModelDef, String> _parseModel(String name, Object? def) {
  if (def is! Map<String, Object?>) {
    return Error('model "$name" must be a JSON object');
  }

  final props = def[_propertiesKey];
  if (props is! Map<String, Object?>) {
    return Error('model "$name" must have "properties"');
  }

  final requiredList = def[_requiredKey];
  final required_ = switch (requiredList) {
    final List<Object?> list => list.whereType<String>().toSet(),
    _ => <String>{},
  };

  final description = def[_descriptionKey];

  final fields = <ModelField>[];
  for (final entry in props.entries) {
    switch (_parseField(name, entry.key, entry.value, required_)) {
      case Success(:final value):
        fields.add(value);
      case Error(:final error):
        return Error(error);
    }
  }

  return Success((
    name: name,
    description: description is String ? description : null,
    fields: fields,
  ));
}

Result<ModelField, String> _parseField(
  String modelName,
  String fieldName,
  Object? prop,
  Set<String> required,
) {
  if (prop is! Map<String, Object?>) {
    return Error('$modelName.$fieldName must be a JSON object');
  }

  return switch (parseFieldType(prop)) {
    Success(:final value) => Success((
      name: fieldName,
      type: value,
      required: required.contains(fieldName),
      description: switch (prop[_descriptionKey]) {
        final String s => s,
        _ => null,
      },
    )),
    Error(:final error) => Error('$modelName.$fieldName: $error'),
  };
}
