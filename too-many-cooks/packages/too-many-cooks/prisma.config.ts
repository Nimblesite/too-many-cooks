import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: `file:${process.env["DATABASE_URL"] ?? ".too_many_cooks/data.db"}`,
  },
});
