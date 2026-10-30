-- The job_groups table (job-group-service), in the app's own Postgres schema.
-- CreateEnum
CREATE TYPE "job_group_status" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "job_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "job_group_status" NOT NULL,
    "total" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "checked_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "job_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_groups_created_at_id_idx" ON "job_groups"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "job_groups_status_id_idx" ON "job_groups"("status", "id");

