/** Facts about the repository and its user that the export needs. */
export interface RepositoryInfo {
  /** The main checkout's absolute path, also when the export runs from a worktree. */
  mainRoot(): Promise<MainRootRepositoryInfoResponse>;
  /** The email address configured as the repository's git user. */
  userEmail(): Promise<UserEmailRepositoryInfoResponse>;
  homeDir(): HomeDirRepositoryInfoResponse;
}

export interface MainRootRepositoryInfoResponse {
  path: string;
}

export interface UserEmailRepositoryInfoResponse {
  /** Undefined when no git user email is configured. */
  email: string | undefined;
}

export interface HomeDirRepositoryInfoResponse {
  path: string;
}
