import mongoose, { Schema, type Document } from 'mongoose';

export interface IDataMigration extends Document {
  module_name: string;
  migrated_keys: string[];
  last_run_at: Date;
  created_at: Date;
  updated_at: Date;
}

const DataMigrationSchema = new Schema<IDataMigration>(
  {
    module_name: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    migrated_keys: {
      type: [String],
      default: [],
    },
    last_run_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const DataMigrationModel =
  mongoose.models.DataMigration || mongoose.model<IDataMigration>('DataMigration', DataMigrationSchema);
