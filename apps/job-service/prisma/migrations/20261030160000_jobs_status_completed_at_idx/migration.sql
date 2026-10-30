-- CreateIndex
CREATE INDEX "jobs_status_completed_at_idx" ON "jobs"("status", "completed_at");
