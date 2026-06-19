typeDiagram

type AgentIdentity {
  agentName:    String
  registeredAt: Int
  lastActive:   Int
}

type AgentRegistration {
  agentName: String
  agentKey:  String
}

type FileLock {
  filePath:   String
  agentName:  String
  acquiredAt: Int
  expiresAt:  Int
  reason:     Option<String>
  version:    Int
}

type LockResult {
  acquired: Bool
  lock:     Option<FileLock>
  error:    Option<String>
}

type Message {
  id:        String
  fromAgent: String
  toAgent:   String
  content:   String
  createdAt: Int
  readAt:    Option<Int>
}

type AgentPlan {
  agentName:   String
  goal:        String
  currentTask: String
  updatedAt:   Int
}

type DbError {
  code:    String
  message: String
}
