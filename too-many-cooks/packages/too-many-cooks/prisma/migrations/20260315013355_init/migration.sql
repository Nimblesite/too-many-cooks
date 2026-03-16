-- CreateTable
CREATE TABLE "identity" (
    "agent_name" TEXT NOT NULL PRIMARY KEY,
    "agent_key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "registered_at" BIGINT NOT NULL,
    "last_active" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "locks" (
    "file_path" TEXT NOT NULL PRIMARY KEY,
    "agent_name" TEXT NOT NULL,
    "acquired_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "locks_agent_name_fkey" FOREIGN KEY ("agent_name") REFERENCES "identity" ("agent_name") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_agent" TEXT NOT NULL,
    "to_agent" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "read_at" BIGINT,
    CONSTRAINT "messages_from_agent_fkey" FOREIGN KEY ("from_agent") REFERENCES "identity" ("agent_name") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plans" (
    "agent_name" TEXT NOT NULL PRIMARY KEY,
    "goal" TEXT NOT NULL,
    "current_task" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "plans_agent_name_fkey" FOREIGN KEY ("agent_name") REFERENCES "identity" ("agent_name") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_agent_key_key" ON "identity"("agent_key");

-- CreateIndex
CREATE INDEX "idx_messages_inbox" ON "messages"("to_agent", "read_at", "created_at" DESC);
