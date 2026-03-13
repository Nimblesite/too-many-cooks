/// Core types for Too Many Cooks data layer.

// Re-export generated model types and serializers.
export * from "./types.gen.js";

/** Error code for resource not found. */
export const ERR_NOT_FOUND: string = "NOT_FOUND";

/** Error code for unauthorized access. */
export const ERR_UNAUTHORIZED: string = "UNAUTHORIZED";

/** Error code when lock is held by another agent. */
export const ERR_LOCK_HELD: string = "LOCK_HELD";

/** Error code when lock has expired. */
export const ERR_LOCK_EXPIRED: string = "LOCK_EXPIRED";

/** Error code for validation failures. */
export const ERR_VALIDATION: string = "VALIDATION";

/** Error code for database errors. */
export const ERR_DATABASE: string = "DATABASE";
