-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "group_id" UUID;

-- CreateIndex
CREATE INDEX "jobs_group_id_created_at_idx" ON "jobs"("group_id", "created_at" DESC);
