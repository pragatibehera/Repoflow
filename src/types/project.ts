export type ProjectStatus = "pending" | "indexing" | "completed" | "failed";

export interface Project {
  id: string;
  status: ProjectStatus;
  // Add other project properties as needed
  name?: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
