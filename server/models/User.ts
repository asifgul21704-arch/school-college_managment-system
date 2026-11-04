import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'super_admin' | 'admin' | 'teacher' | 'parent' | 'student';
export type UserStatus = 'active' | 'inactive' | 'pending' | 'suspended';

export interface IUser extends Document {
  record_id?: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  phone?: string;
  avatar?: string;
  linked_id?: string;
  linked_student_ids?: string[];
  status: UserStatus;
  password_changed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  avatar?: string;
  linked_id?: string;
  linked_student_ids?: string[];
  status: UserStatus;
  created_at: string;
}

const stripSensitiveUserFields = (_doc: unknown, ret: Record<string, any>) => {
  delete ret.password_hash;
  delete ret.password;
  delete ret.password_changed_at;
  delete ret.__v;
  return ret;
};

const UserSchema = new Schema<IUser>(
  {
    record_id: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password_hash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'teacher', 'parent', 'student'],
      default: 'student',
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    avatar: {
      type: String,
      default: '',
    },
    linked_id: {
      type: String,
      default: '',
      index: true,
    },
    linked_student_ids: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'pending', 'suspended'],
      default: 'active',
      index: true,
    },
    password_changed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform: stripSensitiveUserFields,
    },
    toObject: {
      transform: stripSensitiveUserFields,
    },
  }
);

UserSchema.index({ record_id: 1 }, { unique: true, sparse: true });

export function toUserDto(doc: any): UserDto {
  const id = String(doc?.record_id || doc?.id || doc?._id || '');
  const createdRaw = doc?.created_at;
  const createdIso =
    createdRaw instanceof Date
      ? createdRaw.toISOString()
      : typeof createdRaw === 'string' && createdRaw
      ? createdRaw
      : new Date().toISOString();

  return {
    id,
    email: String(doc?.email || '').toLowerCase(),
    name: String(doc?.name || ''),
    role: (doc?.role || 'student') as UserRole,
    phone: doc?.phone !== undefined ? String(doc.phone) : '',
    ...(doc?.avatar ? { avatar: String(doc.avatar) } : {}),
    ...(doc?.linked_id ? { linked_id: String(doc.linked_id) } : {}),
    linked_student_ids: Array.isArray(doc?.linked_student_ids)
      ? doc.linked_student_ids.map((s: unknown) => String(s)).filter(Boolean)
      : [],
    status: (doc?.status || 'active') as UserStatus,
    created_at: createdIso,
  };
}

export const UserModel = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
