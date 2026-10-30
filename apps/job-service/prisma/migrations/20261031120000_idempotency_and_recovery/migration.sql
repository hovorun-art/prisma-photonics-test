-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "idempotency_key" VARCHAR(255),
ADD COLUMN     "request_fingerprint" CHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotency_key_key" ON "jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "jobs_status_updated_at_idx" ON "jobs"("status", "updated_at");

