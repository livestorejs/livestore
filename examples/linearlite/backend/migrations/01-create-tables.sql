-- Create the tables for the linearlite example
BEGIN;

CALL electric.migration_version('20240315_074800');

CREATE TABLE IF NOT EXISTS "issue" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "creator" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "created" DOUBLE PRECISION NOT NULL,
  "modified" DOUBLE PRECISION NOT NULL,
  "kanbanorder" TEXT NOT NULL,
  CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

ALTER TABLE
  issue ENABLE ELECTRIC;

CREATE TABLE IF NOT EXISTS "description" (
  "id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  CONSTRAINT "description_pkey" PRIMARY KEY ("id"),
  FOREIGN KEY (id) REFERENCES issue(id)
);

ALTER TABLE
  description ENABLE ELECTRIC;

CREATE TABLE IF NOT EXISTS "comment" (
  "id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "creator" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "created" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "comment_pkey" PRIMARY KEY ("id"),
  FOREIGN KEY ("issueId") REFERENCES issue(id)
);

ALTER TABLE
  comment ENABLE ELECTRIC;

COMMIT;