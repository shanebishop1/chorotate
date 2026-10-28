export type Runner = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; maxBuffer: number },
) => { status: number | null; stdout: string };

export interface Pull {
  number: number;
  state: string;
  draft: boolean;
  title: string;
  changed_files: number;
  user: { login: string; type: string };
  head: { sha: string; ref: string; repo: { full_name: string } };
  base: { ref: string; repo: { full_name: string } };
  mergeable: boolean | null;
  mergeable_state: string;
  updated_at: string;
}

export interface CIRun {
  id?: number;
  head_sha: string;
  head_branch: string;
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_repository?: { full_name: string };
}

export interface WorkflowEvent {
  workflow_run?: CIRun;
}
