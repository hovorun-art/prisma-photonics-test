import type {
  CreateGroupCreationRequest,
  CreateGroupCreationResponse,
  GroupCreation,
  GroupCreationDeps,
} from './group-creation';

/** `GroupCreation` over the groups and jobs APIs, with a delete of the group when the submit fails. */
export class GroupCreationImpl implements GroupCreation {
  constructor(private readonly d: GroupCreationDeps) {}

  async create(req: CreateGroupCreationRequest): Promise<CreateGroupCreationResponse> {
    const { group } = await this.d.groups.create();
    try {
      await this.d.jobs.createBulk({
        jobs: req.jobs.map((job) => ({ ...job, groupId: group.id })),
      });
    } catch (error) {
      // No job carries the group's id, so it can go; if that fails too, an empty group is left
      // behind (see DECISIONS.md) and the user still learns why the submit failed.
      await this.d.groups.delete({ id: group.id }).catch(() => undefined);
      throw error;
    }
    return { group };
  }
}
