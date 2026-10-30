import { QueryLimitExceededError } from '@job-queue/kernel';

import { JobGroupNotEmptyError } from '../../domain/groups/errors/job-group-not-empty.error.js';
import { JobGroupNotFoundError } from '../../domain/groups/errors/job-group-not-found.error.js';
import type { GroupChildJobs } from '../../domain/groups/group-child-jobs.js';
import type { JobGroupRepository } from '../../domain/groups/job-group-repository.js';
import type {
  CreateJobGroupServiceResponse,
  DeleteJobGroupServiceRequest,
  DeleteJobGroupServiceResponse,
  GetJobGroupServiceRequest,
  GetJobGroupServiceResponse,
  JobGroupService,
  QueryJobGroupServiceRequest,
  QueryJobGroupServiceResponse,
} from '../../domain/groups/job-group-service.js';

export interface JobGroupServiceImplDeps {
  repository: JobGroupRepository;
  childJobs: GroupChildJobs;
}

export interface JobGroupServiceImplParams {
  /** Page size of a query without `limit`. */
  queryDefaultLimit: number;
  /** Largest `limit` a query may ask for. */
  queryMaxLimit: number;
}

/** The group use cases over the group store and job-service's child counts. */
export class JobGroupServiceImpl implements JobGroupService {
  constructor(
    private readonly d: JobGroupServiceImplDeps,
    private readonly p: JobGroupServiceImplParams,
  ) {}

  async create(): Promise<CreateJobGroupServiceResponse> {
    const { group } = await this.d.repository.create();
    return { group };
  }

  async get(req: GetJobGroupServiceRequest): Promise<GetJobGroupServiceResponse> {
    const { group } = await this.d.repository.get({ id: req.id });
    if (!group) throw new JobGroupNotFoundError({ id: req.id });
    return { group };
  }

  async query(req: QueryJobGroupServiceRequest): Promise<QueryJobGroupServiceResponse> {
    const limit = req.limit ?? this.p.queryDefaultLimit;
    if (limit > this.p.queryMaxLimit) {
      throw new QueryLimitExceededError({ maxLimit: this.p.queryMaxLimit });
    }
    return this.d.repository.query({ limit, offset: req.offset });
  }

  async delete(req: DeleteJobGroupServiceRequest): Promise<DeleteJobGroupServiceResponse> {
    await this.get({ id: req.id });
    const { total } = await this.d.childJobs.count({ groupId: req.id });
    if (total > 0) throw new JobGroupNotEmptyError({ id: req.id, total });
    const { deleted } = await this.d.repository.delete({ id: req.id });
    if (!deleted) throw new JobGroupNotFoundError({ id: req.id });
    return {};
  }
}
