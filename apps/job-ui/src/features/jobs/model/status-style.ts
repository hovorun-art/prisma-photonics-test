import type { JobStatus } from '@job-queue/contracts';

/** Badge colours of each status (text and dot / background), from the design's Components screen. */
export const STATUS_STYLE: Readonly<Record<JobStatus, string>> = {
  scheduled: 'text-[#5B3FB8] bg-[#F1EDFC]',
  pending: 'text-[#8A4B00] bg-[#FDF3E2]',
  processing: 'text-[#1F3FC4] bg-[#EBEFFD]',
  completed: 'text-[#13703A] bg-[#E8F5EC]',
  failed: 'text-[#B42121] bg-[#FCEBEB]',
  cancelled: 'text-[#5C5C63] bg-[#F0F0EE]',
};
