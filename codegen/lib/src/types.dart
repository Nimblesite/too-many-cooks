/// Internal model for parsed JSON Schema definitions.
library;

import 'package:nadz/nadz.dart';

/// A single field in a model.
typedef ModelField = ({
  String name,
  FieldType type,
  bool required,
  String? description,
});

/// A model definition parsed from JSON Schema.
typedef ModelDef = ({
  String name,
  String? description,
  List<ModelField> fields,
});

/// The complete schema: a list of model definitions.
typedef Schema = ({List<ModelDef> models});

/// JSON key for the snake_case wire format.
typedef JsonKey = ({String camelCase, String snakeCase});

/// Supported field types.
sealed class FieldType {
  /// Create a field type.
  const FieldType();
}

/// String field.
class StringField extends FieldType {
  /// Create a string field.
  const StringField();
}

/// Integer field.
class IntField extends FieldType {
  /// Create an integer field.
  const IntField();
}

/// Floating point field.
class DoubleField extends FieldType {
  /// Create a double field.
  const DoubleField();
}

/// Boolean field.
class BoolField extends FieldType {
  /// Create a boolean field.
  const BoolField();
}

/// Array/List field with element type.
class ArrayField extends FieldType {
  /// Create an array field.
  const ArrayField(this.items);

  /// The element type.
  final FieldType items;
}

/// Reference to another model.
class RefField extends FieldType {
  /// Create a reference field.
  const RefField(this.modelName);

  /// The referenced model name.
  final String modelName;
}

// -- Naming helpers --

const _upperPattern = '[A-Z]';

/// Convert camelCase to snake_case.
String toSnakeCase(String camel) => camel
    .replaceAllMapped(
      RegExp(_upperPattern),
      (m) => '_${m.group(0)!.toLowerCase()}',
    )
    .replaceAll(RegExp('^_'), '');

/// Convert snake_case to camelCase.
String toCamelCase(String snake) => snake.replaceAllMapped(
  RegExp('_([a-z])'),
  (m) => m.group(1)!.toUpperCase(),
);

/// Parse a JSON Schema type property into a FieldType.
Result<FieldType, String> parseFieldType(Map<String, Object?> prop) {
  final ref = prop[r'$ref'];
  if (ref is String) return Success(RefField(ref));

  final type = prop['type'];
  if (type is! String) return const Error('missing "type" in property');

  return switch (type) {
    'string' => const Success(StringField()),
    'integer' => const Success(IntField()),
    'number' => const Success(DoubleField()),
    'boolean' => const Success(BoolField()),
    'array' => _parseArrayType(prop),
    _ => Error('unsupported type: $type'),
  };
}

Result<FieldType, String> _parseArrayType(Map<String, Object?> prop) {
  final items = prop['items'];
  if (items is! Map<String, Object?>) {
    return const Error('array type requires "items"');
  }
  return switch (parseFieldType(items)) {
    Success(:final value) => Success(ArrayField(value)),
    Error(:final error) => Error(error),
  };
}
