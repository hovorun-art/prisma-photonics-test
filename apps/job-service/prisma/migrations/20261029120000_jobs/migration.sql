-- The jobs table with the query indexes (job-api).
-- CreateEnum
CREATE TYPE "job_type" AS ENUM ('email');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('scheduled', 'pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "job_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "job_status" NOT NULL,
    "priority" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "result" JSONB,
    "error" JSONB,
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_created_at_id_idx" ON "jobs"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "jobs_status_created_at_idx" ON "jobs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_type_created_at_idx" ON "jobs"("type", "created_at" DESC);

