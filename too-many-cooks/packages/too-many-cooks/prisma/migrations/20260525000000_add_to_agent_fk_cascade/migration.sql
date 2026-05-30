-- Adds a foreign key on messages.to_agent → identity.agent_name with
-- ON DELETE CASCADE so deleting an agent removes inbound messages too.
-- Previously only from_agent had a FK, which left orphaned messages
-- whenever the recipient was deleted.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_agent" TEXT NOT NULL,
    "to_agent" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "read_at" BIGINT,
    CONSTRAINT "messages_from_agent_fkey" FOREIGN KEY ("from_agent") REFERENCES "identity" ("agent_name") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_to_agent_fkey" FOREIGN KEY ("to_agent") REFERENCES "identity" ("agent_name") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_messages" ("content", "created_at", "from_agent", "id", "read_at", "to_agent") SELECT "content", "created_at", "from_agent", "id", "read_at", "to_agent" FROM "messages";
DROP TABLE "messages";
ALTER TABLE "new_messages" RENAME TO "messages";
CREATE INDEX "idx_messages_inbox" ON "messages"("to_agent", "read_at", "created_at" DESC);
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
