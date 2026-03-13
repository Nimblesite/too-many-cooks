/// Generated types for Too Many Cooks data layer.

/** Agent identity (public info only - no key). */
export type AgentIdentity = {
  readonly agentName: string;
  readonly registeredAt: number;
  readonly lastActive: number;
};

/** Serialize AgentIdentity to a JSON-compatible map. */
export const agentIdentityToJson: (
  agentIdentity: AgentIdentity,
) => Record<string, unknown> = (
  agentIdentity: AgentIdentity,
): Record<string, unknown> => {return {
  agent_name: agentIdentity.agentName,
  registered_at: agentIdentity.registeredAt,
  last_active: agentIdentity.lastActive,
}};

/** Deserialize AgentIdentity from a JSON map. */
export const agentIdentityFromJson: (
  json: Record<string, unknown>,
) => AgentIdentity = (
  json: Record<string, unknown>,
): AgentIdentity => {return {
  agentName: typeof json.agent_name === "string" ? json.agent_name : "",
  registeredAt:
    typeof json.registered_at === "number" ? json.registered_at : 0,
  lastActive:
    typeof json.last_active === "number" ? json.last_active : 0,
}};

/** Agent registration result (includes secret key). */
export type AgentRegistration = {
  readonly agentName: string;
  readonly agentKey: string;
};

/** Serialize AgentRegistration to a JSON-compatible map. */
export const agentRegistrationToJson: (
  agentRegistration: AgentRegistration,
) => Record<string, unknown> = (
  agentRegistration: AgentRegistration,
): Record<string, unknown> => {return {
  agent_name: agentRegistration.agentName,
  agent_key: agentRegistration.agentKey,
}};

/** Deserialize AgentRegistration from a JSON map. */
export const agentRegistrationFromJson: (
  json: Record<string, unknown>,
) => AgentRegistration = (
  json: Record<string, unknown>,
): AgentRegistration => {return {
  agentName: typeof json.agent_name === "string" ? json.agent_name : "",
  agentKey: typeof json.agent_key === "string" ? json.agent_key : "",
}};

/** File lock info. */
export type FileLock = {
  readonly filePath: string;
  readonly agentName: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly reason: string | null;
  readonly version: number;
};

/** Serialize FileLock to a JSON-compatible map. */
export const fileLockToJson: (
  fileLock: FileLock,
) => Record<string, unknown> = (
  fileLock: FileLock,
): Record<string, unknown> => {return {
  file_path: fileLock.filePath,
  agent_name: fileLock.agentName,
  acquired_at: fileLock.acquiredAt,
  expires_at: fileLock.expiresAt,
  ...(fileLock.reason === null ? {} : { reason: fileLock.reason }),
  version: fileLock.version,
}};

/** Deserialize FileLock from a JSON map. */
export const fileLockFromJson: (
  json: Record<string, unknown>,
) => FileLock = (
  json: Record<string, unknown>,
): FileLock => {return {
  filePath: typeof json.file_path === "string" ? json.file_path : "",
  agentName: typeof json.agent_name === "string" ? json.agent_name : "",
  acquiredAt:
    typeof json.acquired_at === "number" ? json.acquired_at : 0,
  expiresAt: typeof json.expires_at === "number" ? json.expires_at : 0,
  reason: typeof json.reason === "string" ? json.reason : null,
  version: typeof json.version === "number" ? json.version : 0,
}};

/** Lock acquisition result. */
export type LockResult = {
  readonly acquired: boolean;
  readonly lock: FileLock | undefined;
  readonly error: string | undefined;
};

/** Serialize LockResult to a JSON-compatible map. */
export const lockResultToJson: (
  lockResult: LockResult,
) => Record<string, unknown> = (
  lockResult: LockResult,
): Record<string, unknown> => {return {
  acquired: lockResult.acquired,
  ...(lockResult.lock === undefined
    ? {}
    : { lock: fileLockToJson(lockResult.lock) }),
  ...(lockResult.error === undefined ? {} : { error: lockResult.error }),
}};

/** Helper to narrow lock JSON field. */
const narrowLockJson = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === "object" && value !== null) {
    return value as never;
  }
  return null;
};

/** Deserialize LockResult from a JSON map. */
export const lockResultFromJson: (
  json: Record<string, unknown>,
) => LockResult = (
  json: Record<string, unknown>,
): LockResult => {
  const lockJson: Record<string, unknown> | null = narrowLockJson(json.lock);
  return {
    acquired: typeof json.acquired === "boolean" ? json.acquired : false,
    lock: lockJson !== null
      ? fileLockFromJson(lockJson)
      : undefined,
    error: typeof json.error === "string" ? json.error : undefined,
  };
};

/** Inter-agent message. */
export type Message = {
  readonly id: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly content: string;
  readonly createdAt: number;
  readonly readAt: number | undefined;
};

/** Serialize Message to a JSON-compatible map. */
export const messageToJson: (message: Message) => Record<string, unknown> = (message: Message): Record<string, unknown> => {return {
  id: message.id,
  from_agent: message.fromAgent,
  to_agent: message.toAgent,
  content: message.content,
  created_at: message.createdAt,
  ...(message.readAt === undefined ? {} : { read_at: message.readAt }),
}};

/** Deserialize Message from a JSON map. */
export const messageFromJson: (
  json: Record<string, unknown>,
) => Message = (
  json: Record<string, unknown>,
): Message => {return {
  id: typeof json.id === "string" ? json.id : "",
  fromAgent:
    typeof json.from_agent === "string" ? json.from_agent : "",
  toAgent: typeof json.to_agent === "string" ? json.to_agent : "",
  content: typeof json.content === "string" ? json.content : "",
  createdAt: typeof json.created_at === "number" ? json.created_at : 0,
  readAt: typeof json.read_at === "number" ? json.read_at : undefined,
}};

/** Agent plan (what they're doing and why). */
export type AgentPlan = {
  readonly agentName: string;
  readonly goal: string;
  readonly currentTask: string;
  readonly updatedAt: number;
};

/** Serialize AgentPlan to a JSON-compatible map. */
export const agentPlanToJson: (
  agentPlan: AgentPlan,
) => Record<string, unknown> = (
  agentPlan: AgentPlan,
): Record<string, unknown> => {return {
  agent_name: agentPlan.agentName,
  goal: agentPlan.goal,
  current_task: agentPlan.currentTask,
  updated_at: agentPlan.updatedAt,
}};

/** Deserialize AgentPlan from a JSON map. */
export const agentPlanFromJson: (
  json: Record<string, unknown>,
) => AgentPlan = (
  json: Record<string, unknown>,
): AgentPlan => {return {
  agentName: typeof json.agent_name === "string" ? json.agent_name : "",
  goal: typeof json.goal === "string" ? json.goal : "",
  currentTask:
    typeof json.current_task === "string" ? json.current_task : "",
  updatedAt: typeof json.updated_at === "number" ? json.updated_at : 0,
}};

/** Database error. */
export type DbError = {
  readonly code: string;
  readonly message: string;
};

/** Serialize DbError to a JSON-compatible map. */
export const dbErrorToJson: (dbError: DbError) => Record<string, unknown> = (dbError: DbError): Record<string, unknown> => {return {
  code: dbError.code,
  message: dbError.message,
}};

/** Deserialize DbError from a JSON map. */
export const dbErrorFromJson: (
  json: Record<string, unknown>,
) => DbError = (
  json: Record<string, unknown>,
): DbError => {return {
  code: typeof json.code === "string" ? json.code : "",
  message: typeof json.message === "string" ? json.message : "",
}};
