export interface SkillOption {
  name: string;
  description: string;
  category?: string;
  preset?: boolean;
}

export interface MemoryCandidateRow {
  id: string;
  content: string;
  status?: string;
}
