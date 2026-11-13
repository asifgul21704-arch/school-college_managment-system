import mongoose, { Schema, Document } from 'mongoose';

export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TaskStatus = 'Pending' | 'In Progress' | 'Completed';

export interface ITeacherTask extends Document {
  task_id: string;
  title: string;
  description: string;
  teacher_id: string;
  teacher_name?: string;
  class_name?: string;
  section?: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string;
  assigned_by: string;
  completion_notes?: string;
  completed_at?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeacherTaskDto {
  id: string;
  task_id: string;
  title: string;
  description: string;
  teacher_id: string;
  teacher_name: string;
  class_name: string;
  section: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string;
  assigned_by: string;
  completion_notes: string;
  completed_at: string;
  created_at: string;
}

const TeacherTaskSchema = new Schema<ITeacherTask>(
  {
    task_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    teacher_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    teacher_name: {
      type: String,
      default: '',
      trim: true,
    },
    class_name: {
      type: String,
      default: '',
      trim: true,
    },
    section: {
      type: String,
      default: '',
      trim: true,
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Urgent'],
      default: 'Medium',
      index: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'In Progress', 'Completed'],
      default: 'Pending',
      index: true,
    },
    due_date: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    assigned_by: {
      type: String,
      default: 'Administration',
      trim: true,
    },
    completion_notes: {
      type: String,
      default: '',
      trim: true,
    },
    completed_at: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

TeacherTaskSchema.index({ teacher_id: 1, status: 1 });


export function toTeacherTaskDto(doc: any): TeacherTaskDto {
  const id = String(doc?.task_id || doc?._id || '');
  return {
    id,
    task_id: String(doc?.task_id || id),
    title: String(doc?.title || ''),
    description: String(doc?.description || ''),
    teacher_id: String(doc?.teacher_id || ''),
    teacher_name: String(doc?.teacher_name || ''),
    class_name: String(doc?.class_name || ''),
    section: String(doc?.section || ''),
    priority: (doc?.priority || 'Medium') as TaskPriority,
    status: (doc?.status || 'Pending') as TaskStatus,
    due_date: String(doc?.due_date || ''),
    assigned_by: String(doc?.assigned_by || 'Administration'),
    completion_notes: String(doc?.completion_notes || ''),
    completed_at: String(doc?.completed_at || ''),
    created_at: doc?.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
  };
}

export const TeacherTaskModel =
  mongoose.models.TeacherTask || mongoose.model<ITeacherTask>('TeacherTask', TeacherTaskSchema);
