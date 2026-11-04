import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  UserModel,
  StudentModel,
  TeacherModel,
  ParentModel,
  ClassModel,
  SectionModel,
  SubjectModel,
  EnrollmentModel,
  computeActiveEnrollmentKey,
  TeacherAssignmentModel,
  AttendanceModel,
  ExamModel,
  ResultModel,
  FeeModel,
  FeePaymentModel,
  AdmissionModel,
  computeAdmissionDedupeKey,
  TimetableModel,
  AnnouncementModel,
  SchoolEventModel,
  GalleryModel,
  ContactMessageModel,
  NotificationModel,
  AuditLogModel,
  SchoolSettingsModel,
  DEFAULT_SCHOOL_SETTINGS,
  DataMigrationModel,
} from '../models/index.ts';

/**
 * Seeds and migrates data from data/db.json into MongoDB Atlas collections.
 * Ensures the database is fully seeded with realistic and complete operational data.
 */
export function isLocalSeedBlocked(): boolean {
  const rawMongoUri = String(process.env.MONGODB_URI || '').trim();
  const isAtlasClusterUri =
    rawMongoUri.startsWith('mongodb+srv://') || rawMongoUri.includes('.mongodb.net');
  const isProd = process.env.NODE_ENV === 'production';

  // 1. MongoDB Atlas clusters NEVER seed from local db.json unless ALLOW_PRODUCTION_SEED === 'true'
  if (isAtlasClusterUri) {
    return process.env.ALLOW_PRODUCTION_SEED !== 'true';
  }

  // 2. Explicit disable always blocks
  if (process.env.DISABLE_AUTO_SEED === 'true') {
    return true;
  }

  // 3. Explicit opt-in on non-Atlas loopback test instances (e.g. MongoMemoryServer regression suites)
  if (process.env.DISABLE_AUTO_SEED === 'false' || process.env.ALLOW_PRODUCTION_SEED === 'true') {
    return false;
  }

  // 4. Fresh-Start default: block in production or whenever ALLOW_PRODUCTION_SEED === 'false'
  if (isProd || process.env.ALLOW_PRODUCTION_SEED === 'false') {
    return true;
  }

  return false;
}

export async function seedMongoFromLocal(): Promise<{ success: boolean; counts: Record<string, number> }> {
  if (isLocalSeedBlocked()) {
    throw new Error(
      '[Fresh-Start Guard] Importing or seeding from local data/db.json is disabled for production and MongoDB Atlas databases.'
    );
  }
  const counts: Record<string, number> = {};
  const dataPath = process.env.DB_FILE_PATH
    ? path.resolve(process.env.DB_FILE_PATH)
    : path.resolve(process.cwd(), 'data', 'db.json');

  let localData: any = null;
  if (fs.existsSync(dataPath)) {
    try {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      localData = JSON.parse(raw);
    } catch (e) {
      console.warn('[Mongo Seed] Could not read db.json:', e);
    }
  }

  // Reconcile legacy index definitions safely before upserting/backfilling
  try {
    const enrIndexes = await EnrollmentModel.collection.indexes();
    const legacyEnrIdx = enrIndexes.find(
      (idx: any) => idx.name === 'student_id_1_academic_year_1' && idx.unique === true
    );
    if (legacyEnrIdx) {
      await EnrollmentModel.collection.dropIndex('student_id_1_academic_year_1');
      await EnrollmentModel.syncIndexes();
    }
  } catch {
    // Collection may not exist yet on fresh DB
  }

  try {
    const tchIndexes = await TeacherModel.collection.indexes();
    const legacyTchEmailIdx = tchIndexes.find(
      (idx: any) => idx.name === 'email_1' && idx.unique === true && !idx.sparse
    );
    if (legacyTchEmailIdx) {
      await TeacherModel.collection.dropIndex('email_1');
      await TeacherModel.syncIndexes();
    }
  } catch {
    // Collection may not exist yet on fresh DB
  }

  // Build non-guessing cross-reference maps strictly from explicit IDs in localData.users
  const studentIdToUserId = new Map<string, string>();
  const studentIdToParentUserId = new Map<string, string>();
  const teacherIdToUserId = new Map<string, string>();

  if (Array.isArray(localData?.users)) {
    for (const u of localData.users) {
      const uid = u?.id ? String(u.id).trim() : '';
      const linked = u?.linked_id ? String(u.linked_id).trim() : '';
      if (!uid) continue;
      if (u.role === 'student' && linked) {
        studentIdToUserId.set(linked, uid);
      } else if (u.role === 'teacher' && linked) {
        teacherIdToUserId.set(linked, uid);
      } else if (u.role === 'parent') {
        if (linked) studentIdToParentUserId.set(linked, uid);
        if (Array.isArray(u.linked_student_ids)) {
          for (const sid of u.linked_student_ids) {
            if (sid) studentIdToParentUserId.set(String(sid).trim(), uid);
          }
        }
      }
    }
  }

  // 1. Users — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const usrMigrationDoc = await DataMigrationModel.findOne({ module_name: 'users' }).lean();
  const migratedUsrSet = new Set<string>(usrMigrationDoc?.migrated_keys || []);
  const newlyMigratedUsrs: string[] = [];

  if (Array.isArray(localData?.users) && localData.users.length > 0) {
    const baseMs = Date.UTC(2026, 0, 10, 8, 0, 0);
    for (let idx = 0; idx < localData.users.length; idx++) {
      const u = localData.users[idx];
      const recId = u?.id ? String(u.id).trim() : '';
      const cleanEmail = u?.email ? String(u.email).trim().toLowerCase() : '';
      const migKey = recId || (cleanEmail ? `usr_legacy_${cleanEmail}` : '');
      if (!migKey || migratedUsrSet.has(migKey)) {
        continue;
      }

      let existingUsr = recId ? await UserModel.findOne({ record_id: recId }) : null;
      if (!existingUsr && cleanEmail) {
        existingUsr = await UserModel.findOne({
          email: cleanEmail,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingUsr) {
        let changed = false;
        if (recId && !existingUsr.record_id) {
          existingUsr.record_id = recId;
          changed = true;
        }
        if (u.linked_id && !existingUsr.linked_id) {
          existingUsr.linked_id = String(u.linked_id).trim();
          changed = true;
        }
        if (
          Array.isArray(u.linked_student_ids) &&
          u.linked_student_ids.length > 0 &&
          (!existingUsr.linked_student_ids || existingUsr.linked_student_ids.length === 0)
        ) {
          existingUsr.linked_student_ids = u.linked_student_ids.map((s: unknown) => String(s).trim()).filter(Boolean);
          changed = true;
        }
        if (changed) {
          await existingUsr.save();
        }
      } else if (cleanEmail && u?.password_hash) {
        const parsedCreated = u.created_at ? new Date(u.created_at) : new Date(baseMs + idx * 1000);
        const validRoles = ['super_admin', 'admin', 'teacher', 'parent', 'student'] as const;
        const roleVal = validRoles.includes(u.role) ? u.role : 'student';
        const statusVal = u.status === 'inactive' || u.status === 'pending' ? u.status : 'active';
        const doc = new UserModel({
          ...(recId ? { record_id: recId } : {}),
          email: cleanEmail,
          password_hash: String(u.password_hash),
          name: u.name ? String(u.name).trim() : 'User',
          role: roleVal,
          phone: u.phone ? String(u.phone).trim() : '',
          avatar: u.avatar ? String(u.avatar) : '',
          linked_id: u.linked_id ? String(u.linked_id).trim() : '',
          linked_student_ids: Array.isArray(u.linked_student_ids)
            ? u.linked_student_ids.map((s: unknown) => String(s).trim()).filter(Boolean)
            : [],
          status: statusVal,
          created_at: isNaN(parsedCreated.getTime()) ? new Date(baseMs + idx * 1000) : parsedCreated,
        });
        await doc.save();
      }

      newlyMigratedUsrs.push(migKey);
      migratedUsrSet.add(migKey);
    }
  } else if (!usrMigrationDoc && (await UserModel.countDocuments()) === 0) {
    const salt = bcrypt.genSaltSync(10);
    const adminPass = bcrypt.hashSync('AdminPassword123!', salt);
    await UserModel.create({
      record_id: 'usr_super_admin',
      email: 'admin@shawanschool.edu.pk',
      password_hash: adminPass,
      name: 'Principal & Chief Administrator',
      role: 'super_admin',
      phone: '+92 300 1234567',
      status: 'active',
    });
    newlyMigratedUsrs.push('usr_super_admin');
  }

  if (newlyMigratedUsrs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'users' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedUsrs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.users = await UserModel.countDocuments();

  // 2. Students — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const stdMigrationDoc = await DataMigrationModel.findOne({ module_name: 'students' }).lean();
  const migratedStdSet = new Set<string>(stdMigrationDoc?.migrated_keys || []);
  const newlyMigratedStds: string[] = [];

  if (Array.isArray(localData?.students) && localData.students.length > 0) {
    // Descending base timestamp preserves legacy unshift (newest-first) ordering
    const baseMs = Date.UTC(2026, 9, 27, 12, 0, 0);
    for (let idx = 0; idx < localData.students.length; idx++) {
      const s = localData.students[idx];
      const recId = s?.id ? String(s.id).trim() : '';
      const cleanAdm = s?.admission_no ? String(s.admission_no).trim() : '';
      const migKey = recId || (cleanAdm ? `std_legacy_${cleanAdm.toUpperCase()}` : '');
      if (!migKey || migratedStdSet.has(migKey)) {
        continue;
      }

      // Match ONLY by explicit record_id or admission_no — never merge by name or phone
      let existingStd = recId ? await StudentModel.findOne({ record_id: recId }) : null;
      if (!existingStd && cleanAdm) {
        existingStd = await StudentModel.findOne({
          admission_no: cleanAdm,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      const explicitUserId = s?.user_id
        ? String(s.user_id).trim()
        : recId
        ? studentIdToUserId.get(recId) || ''
        : '';
      const explicitParentUserId = s?.parent_user_id
        ? String(s.parent_user_id).trim()
        : recId
        ? studentIdToParentUserId.get(recId) || ''
        : '';

      if (existingStd) {
        let changed = false;
        if (recId && !existingStd.record_id) {
          existingStd.record_id = recId;
          changed = true;
        }
        // Clean up pre-Phase-9 seed bug where user_id stored std_* instead of usr_*
        if (existingStd.user_id === recId || existingStd.user_id === '') {
          existingStd.user_id = explicitUserId || undefined;
          changed = true;
        } else if (!existingStd.user_id && explicitUserId) {
          existingStd.user_id = explicitUserId;
          changed = true;
        }
        if (!existingStd.parent_user_id && explicitParentUserId) {
          existingStd.parent_user_id = explicitParentUserId;
          changed = true;
        }
        if (changed) {
          await existingStd.save();
        }
      } else if (cleanAdm && s?.full_name && s?.class_name) {
        const cleanRoll = s.roll_no ? String(s.roll_no).trim() : String(101 + idx);
        const cleanSec = s.section ? String(s.section).trim() : 'A';
        const parsedCreated = s.created_at ? new Date(s.created_at) : new Date(baseMs - idx * 1000);
        const doc = new StudentModel({
          ...(recId ? { record_id: recId } : {}),
          admission_no: cleanAdm,
          roll_no: cleanRoll,
          full_name: String(s.full_name).trim(),
          father_name: s.father_name ? String(s.father_name).trim() : 'Guardian',
          dob: s.dob !== undefined && s.dob !== null ? String(s.dob).trim() : '',
          gender: s.gender === 'Female' || s.gender === 'Other' ? s.gender : 'Male',
          class_name: String(s.class_name).trim(),
          section: cleanSec,
          contact_no: s.contact_no ? String(s.contact_no).trim() : '',
          address: s.address ? String(s.address).trim() : '',
          emergency_contact: s.emergency_contact ? String(s.emergency_contact).trim() : '',
          profile_image: s.profile_image ? String(s.profile_image) : '',
          admission_date: s.admission_date ? String(s.admission_date) : '2026-01-15',
          academic_status:
            s.academic_status === 'Inactive' || s.academic_status === 'Graduated' || s.academic_status === 'Suspended'
              ? s.academic_status
              : 'Active',
          ...(explicitParentUserId ? { parent_user_id: explicitParentUserId } : {}),
          ...(explicitUserId ? { user_id: explicitUserId } : {}),
          created_at: isNaN(parsedCreated.getTime()) ? new Date(baseMs - idx * 1000) : parsedCreated,
        });
        await doc.save();
      }

      newlyMigratedStds.push(migKey);
      migratedStdSet.add(migKey);
    }
  }

  if (newlyMigratedStds.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'students' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedStds } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.students = await StudentModel.countDocuments();

  // 3. Teachers — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const tchMigrationDoc = await DataMigrationModel.findOne({ module_name: 'teachers' }).lean();
  const migratedTchSet = new Set<string>(tchMigrationDoc?.migrated_keys || []);
  const newlyMigratedTchs: string[] = [];

  if (Array.isArray(localData?.teachers) && localData.teachers.length > 0) {
    const baseMs = Date.UTC(2026, 8, 1, 8, 0, 0);
    for (let idx = 0; idx < localData.teachers.length; idx++) {
      const t = localData.teachers[idx];
      const recId = t?.id ? String(t.id).trim() : '';
      const cleanEmail = t?.email ? String(t.email).trim().toLowerCase() : '';
      const migKey =
        recId ||
        (cleanEmail
          ? `tch_legacy_${cleanEmail}`
          : t?.name
          ? `tch_legacy_name_${String(t.name).trim().toLowerCase()}_${idx}`
          : '');
      if (!migKey || migratedTchSet.has(migKey)) {
        continue;
      }

      let existingTch = recId ? await TeacherModel.findOne({ record_id: recId }) : null;
      if (!existingTch && cleanEmail) {
        existingTch = await TeacherModel.findOne({
          email: cleanEmail,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      const linkedUserId = t?.user_id
        ? String(t.user_id).trim()
        : recId
        ? teacherIdToUserId.get(recId) || ''
        : '';

      if (existingTch) {
        let changed = false;
        if (recId && !existingTch.record_id) {
          existingTch.record_id = recId;
          changed = true;
        }
        if (linkedUserId && !existingTch.user_id) {
          existingTch.user_id = linkedUserId;
          changed = true;
        }
        if (changed) {
          await existingTch.save();
        }
      } else if (t?.name && t?.subject) {
        const parsedCreated = t.created_at ? new Date(t.created_at) : new Date(baseMs - idx * 1000);
        const doc = new TeacherModel({
          ...(recId ? { record_id: recId } : {}),
          ...(linkedUserId ? { user_id: linkedUserId } : {}),
          name: String(t.name).trim(),
          profile_photo: t.profile_photo ? String(t.profile_photo) : '',
          qualification: t.qualification ? String(t.qualification).trim() : '',
          subject: String(t.subject).trim(),
          classes: Array.isArray(t.classes) ? t.classes.map((c: unknown) => String(c).trim()).filter(Boolean) : [],
          contact_no: t.contact_no ? String(t.contact_no).trim() : '',
          ...(cleanEmail ? { email: cleanEmail } : {}),
          joining_date: t.joining_date ? String(t.joining_date) : '2024-01-01',
          experience: t.experience ? String(t.experience) : '',
          status: t.status === 'On Leave' || t.status === 'Resigned' ? t.status : 'Active',
          bio: t.bio ? String(t.bio) : '',
          created_at: isNaN(parsedCreated.getTime()) ? new Date(baseMs - idx * 1000) : parsedCreated,
        });
        await doc.save();
      }

      newlyMigratedTchs.push(migKey);
      migratedTchSet.add(migKey);
    }
  }

  if (newlyMigratedTchs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'teachers' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedTchs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.teachers = await TeacherModel.countDocuments();

  // 4. Parents — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const prtMigrationDoc = await DataMigrationModel.findOne({ module_name: 'parents' }).lean();
  const migratedPrtSet = new Set<string>(prtMigrationDoc?.migrated_keys || []);
  const newlyMigratedPrts: string[] = [];

  if (Array.isArray(localData?.parents) && localData.parents.length > 0) {
    for (let idx = 0; idx < localData.parents.length; idx++) {
      const p = localData.parents[idx];
      const recId = p?.id ? String(p.id).trim() : '';
      const cleanEmail = p?.email ? String(p.email).trim().toLowerCase() : '';
      const migKey = recId || (cleanEmail ? `prt_legacy_${cleanEmail}` : '');
      if (!migKey || migratedPrtSet.has(migKey)) continue;

      let existingPrt = recId ? await ParentModel.findOne({ record_id: recId }) : null;
      if (!existingPrt && cleanEmail) {
        existingPrt = await ParentModel.findOne({ email: cleanEmail });
      }
      if (existingPrt) {
        if (recId && !existingPrt.record_id) {
          existingPrt.record_id = recId;
          await existingPrt.save();
        }
      } else if (cleanEmail && p?.name) {
        await ParentModel.create({
          ...(recId ? { record_id: recId } : {}),
          user_id: p.user_id ? String(p.user_id).trim() : recId || cleanEmail,
          name: String(p.name).trim(),
          father_name: p.father_name ? String(p.father_name).trim() : String(p.name).trim(),
          phone: p.phone ? String(p.phone).trim() : '',
          email: cleanEmail,
          address: p.address ? String(p.address).trim() : '',
          occupation: p.occupation ? String(p.occupation).trim() : '',
          linked_students: Array.isArray(p.linked_students)
            ? p.linked_students.map((s: unknown) => String(s).trim()).filter(Boolean)
            : [],
        });
      }
      newlyMigratedPrts.push(migKey);
      migratedPrtSet.add(migKey);
    }
  }

  // Also backfill ParentModel profiles once for legacy parent-role users from localData.users
  if (Array.isArray(localData?.users)) {
    for (const u of localData.users) {
      if (u?.role !== 'parent' || !u?.email) continue;
      const cleanEmail = String(u.email).trim().toLowerCase();
      const canonicalUserId = u.id ? String(u.id).trim() : '';
      const migKey = `prt_user_${canonicalUserId || cleanEmail}`;
      if (migratedPrtSet.has(migKey)) continue;

      const userDoc = await UserModel.findOne({
        $or: [
          ...(canonicalUserId ? [{ record_id: canonicalUserId }] : []),
          { email: cleanEmail },
        ],
      }).lean();

      if (userDoc) {
        const uid = String(userDoc.record_id || userDoc._id);
        const recId = `prt_${uid}`;
        const existingPrt = await ParentModel.findOne({
          $or: [{ record_id: recId }, { email: cleanEmail }],
        });
        const linkedIds = Array.from(
          new Set(
            [
              ...(userDoc.linked_id ? [String(userDoc.linked_id)] : []),
              ...(Array.isArray(userDoc.linked_student_ids) ? userDoc.linked_student_ids.map(String) : []),
            ].filter(Boolean)
          )
        );
        if (existingPrt) {
          let changed = false;
          if (!existingPrt.record_id) {
            existingPrt.record_id = recId;
            changed = true;
          }
          if (existingPrt.user_id !== uid && existingPrt.user_id === String(userDoc._id)) {
            existingPrt.user_id = uid;
            changed = true;
          }
          if ((!existingPrt.linked_students || existingPrt.linked_students.length === 0) && linkedIds.length > 0) {
            existingPrt.linked_students = linkedIds;
            changed = true;
          }
          if (changed) {
            await existingPrt.save();
          }
        } else {
          await ParentModel.create({
            record_id: recId,
            user_id: uid,
            name: String(userDoc.name || 'Parent'),
            father_name: String(userDoc.name || 'Parent'),
            phone: userDoc.phone ? String(userDoc.phone) : '',
            email: cleanEmail,
            linked_students: linkedIds,
          });
        }
      }

      newlyMigratedPrts.push(migKey);
      migratedPrtSet.add(migKey);
    }
  }

  if (newlyMigratedPrts.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'parents' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedPrts } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.parents = await ParentModel.countDocuments();

  // 4b. Enrollments — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const enrMigrationDoc = await DataMigrationModel.findOne({ module_name: 'enrollments' }).lean();
  const migratedEnrSet = new Set<string>(enrMigrationDoc?.migrated_keys || []);
  const newlyMigratedEnrs: string[] = [];

  if (Array.isArray(localData?.enrollments) && localData.enrollments.length > 0) {
    const baseMs = Date.UTC(2026, 9, 27, 12, 0, 0);
    for (let idx = 0; idx < localData.enrollments.length; idx++) {
      const e = localData.enrollments[idx];
      const recId = e?.id ? String(e.id).trim() : '';
      const studentId = e?.student_id ? String(e.student_id).trim() : '';
      const year = e?.academic_year ? String(e.academic_year).trim() : '2026-2027';
      const migKey = recId || (studentId ? `enr_legacy_${studentId}::${year}::${idx}` : '');
      if (!migKey || migratedEnrSet.has(migKey)) continue;

      let existingEnr = recId ? await EnrollmentModel.findOne({ record_id: recId }) : null;
      const statusVal =
        e?.status === 'Transferred' || e?.status === 'Completed' || e?.status === 'Dropped'
          ? e.status
          : 'Active';
      const activeKey = computeActiveEnrollmentKey(studentId, year, statusVal);

      if (!existingEnr && activeKey) {
        existingEnr = await EnrollmentModel.findOne({
          $or: [
            { active_enrollment_key: activeKey },
            { student_id: studentId, academic_year: year, status: 'Active' },
          ],
        });
      }

      if (existingEnr) {
        let changed = false;
        if (recId && !existingEnr.record_id) {
          existingEnr.record_id = recId;
          changed = true;
        }
        if (activeKey && existingEnr.status === 'Active' && existingEnr.active_enrollment_key !== activeKey) {
          existingEnr.active_enrollment_key = activeKey;
          changed = true;
        }
        if (changed) {
          await existingEnr.save();
        }
      } else if (studentId && e?.class_name) {
        const studentClauses: Record<string, any>[] = [{ record_id: studentId }];
        if (mongoose.Types.ObjectId.isValid(studentId) && /^[a-fA-F0-9]{24}$/.test(studentId)) {
          studentClauses.push({ _id: new mongoose.Types.ObjectId(studentId) });
        }
        const studentExists = await StudentModel.findOne(
          studentClauses.length === 1 ? studentClauses[0] : { $or: studentClauses }
        ).lean();

        if (studentExists) {
          const parsedCreated = e.created_at ? new Date(e.created_at) : new Date(baseMs - idx * 1000);
          const doc = new EnrollmentModel({
            ...(recId ? { record_id: recId } : {}),
            student_id: studentId,
            student_name: e.student_name ? String(e.student_name).trim() : studentExists.full_name,
            class_name: String(e.class_name).trim(),
            section: e.section ? String(e.section).trim() : studentExists.section || 'A',
            academic_year: year,
            roll_no: e.roll_no ? String(e.roll_no).trim() : studentExists.roll_no || '',
            enrollment_date: e.enrollment_date ? String(e.enrollment_date) : '2026-09-01',
            status: statusVal,
            ...(e.transfer_reason ? { transfer_reason: String(e.transfer_reason).trim() } : {}),
            ...(activeKey ? { active_enrollment_key: activeKey } : {}),
            created_at: isNaN(parsedCreated.getTime()) ? new Date(baseMs - idx * 1000) : parsedCreated,
          });
          await doc.save();
        }
      }

      newlyMigratedEnrs.push(migKey);
      migratedEnrSet.add(migKey);
    }
  }

  if (newlyMigratedEnrs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'enrollments' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedEnrs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.enrollments = await EnrollmentModel.countDocuments();

  // 4c. Teacher Assignments — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const asgMigrationDoc = await DataMigrationModel.findOne({ module_name: 'teacher_assignments' }).lean();
  const migratedAsgSet = new Set<string>(asgMigrationDoc?.migrated_keys || []);
  const newlyMigratedAsgs: string[] = [];

  if (Array.isArray(localData?.teacher_assignments) && localData.teacher_assignments.length > 0) {
    const baseMs = Date.UTC(2026, 7, 15, 8, 0, 0);
    for (let idx = 0; idx < localData.teacher_assignments.length; idx++) {
      const a = localData.teacher_assignments[idx];
      const recId = a?.id ? String(a.id).trim() : '';
      const teacherId = a?.teacher_id ? String(a.teacher_id).trim() : '';
      const cleanClass = a?.class_name ? String(a.class_name).trim() : '';
      const cleanSec = a?.section ? String(a.section).trim() : 'A';
      const cleanSubj = a?.subject ? String(a.subject).trim() : '';
      const cleanSession = a?.academic_session ? String(a.academic_session).trim() : '2026-2027';
      const migKey =
        recId ||
        (teacherId && cleanClass && cleanSubj
          ? `asg_legacy_${teacherId}|${cleanClass.toLowerCase()}|${cleanSec.toLowerCase()}|${cleanSubj.toLowerCase()}|${cleanSession}`
          : '');
      if (!migKey || migratedAsgSet.has(migKey)) continue;

      let existingAsg = recId ? await TeacherAssignmentModel.findOne({ record_id: recId }) : null;
      if (!existingAsg && teacherId && cleanClass && cleanSubj) {
        existingAsg = await TeacherAssignmentModel.findOne({
          teacher_id: teacherId,
          class_name: cleanClass,
          section: cleanSec,
          subject: cleanSubj,
          academic_session: cleanSession,
        });
      }

      if (existingAsg) {
        if (recId && !existingAsg.record_id) {
          existingAsg.record_id = recId;
          await existingAsg.save();
        }
      } else if (teacherId && cleanClass && cleanSubj) {
        const teacherClauses: Record<string, any>[] = [{ record_id: teacherId }];
        if (mongoose.Types.ObjectId.isValid(teacherId) && /^[a-fA-F0-9]{24}$/.test(teacherId)) {
          teacherClauses.push({ _id: new mongoose.Types.ObjectId(teacherId) });
        }
        const teacherDoc = await TeacherModel.findOne(
          teacherClauses.length === 1 ? teacherClauses[0] : { $or: teacherClauses }
        ).lean();

        if (teacherDoc) {
          const parsedCreated = a.created_at ? new Date(a.created_at) : new Date(baseMs - idx * 1000);
          const doc = new TeacherAssignmentModel({
            ...(recId ? { record_id: recId } : {}),
            teacher_id: teacherId,
            teacher_name: a.teacher_name ? String(a.teacher_name).trim() : teacherDoc.name,
            class_name: cleanClass,
            section: cleanSec,
            subject: cleanSubj,
            academic_session: cleanSession,
            assigned_date: a.assigned_date ? String(a.assigned_date) : '2026-08-15',
            ...(a.is_class_teacher !== undefined ? { is_class_teacher: Boolean(a.is_class_teacher) } : {}),
            created_at: isNaN(parsedCreated.getTime()) ? new Date(baseMs - idx * 1000) : parsedCreated,
          });
          await doc.save();
        }
      }

      newlyMigratedAsgs.push(migKey);
      migratedAsgSet.add(migKey);
    }
  }

  if (newlyMigratedAsgs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'teacher_assignments' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedAsgs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.teacher_assignments = await TeacherAssignmentModel.countDocuments();

  // 5. Classes — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const clsMigrationDoc = await DataMigrationModel.findOne({ module_name: 'classes' }).lean();
  const migratedClsSet = new Set<string>(clsMigrationDoc?.migrated_keys || []);
  const newlyMigratedCls: string[] = [];

  if (Array.isArray(localData?.classes) && localData.classes.length > 0) {
    const baseMs = Date.UTC(2026, 0, 10, 8, 0, 0);
    for (let idx = 0; idx < localData.classes.length; idx++) {
      const c = localData.classes[idx];
      const recId = c?.id ? String(c.id).trim() : '';
      const cleanName = c?.name ? String(c.name).trim() : '';
      const migKey = recId || (cleanName ? `cls_legacy_${cleanName.toLowerCase()}` : '');
      if (!migKey || migratedClsSet.has(migKey)) {
        continue;
      }

      let existingCls = recId ? await ClassModel.findOne({ record_id: recId }) : null;
      if (!existingCls && cleanName) {
        existingCls = await ClassModel.findOne({
          name: cleanName,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingCls) {
        if (recId && !existingCls.record_id) {
          existingCls.record_id = recId;
          await existingCls.save();
        }
      } else if (cleanName) {
        const feeVal =
          typeof c.monthly_tuition_fee === 'number' && c.monthly_tuition_fee >= 0
            ? c.monthly_tuition_fee
            : Math.max(0, Number(c.monthly_tuition_fee) || 0);
        const capVal = Math.max(1, Number(c.capacity) || 40);
        const doc = new ClassModel({
          ...(recId ? { record_id: recId } : {}),
          name: cleanName,
          grade_level: c.grade_level !== undefined ? String(c.grade_level).trim() : '',
          stream: c.stream ? String(c.stream).trim() : 'General',
          monthly_tuition_fee: feeVal,
          capacity: capVal,
          class_teacher: c.class_teacher !== undefined ? String(c.class_teacher).trim() : '',
          created_at: c.created_at ? new Date(c.created_at) : new Date(baseMs + idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedCls.push(migKey);
      migratedClsSet.add(migKey);
    }
  }

  if (newlyMigratedCls.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'classes' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedCls } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.classes = await ClassModel.countDocuments();

  // 6. Sections — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const secMigrationDoc = await DataMigrationModel.findOne({ module_name: 'sections' }).lean();
  const migratedSecSet = new Set<string>(secMigrationDoc?.migrated_keys || []);
  const newlyMigratedSecs: string[] = [];

  if (Array.isArray(localData?.sections) && localData.sections.length > 0) {
    const baseMs = Date.UTC(2026, 0, 10, 8, 10, 0);
    for (let idx = 0; idx < localData.sections.length; idx++) {
      const sec = localData.sections[idx];
      const recId = sec?.id ? String(sec.id).trim() : '';
      const cleanClassName = sec?.class_name ? String(sec.class_name).trim() : '';
      const cleanSecName = sec?.name ? String(sec.name).trim() : '';
      const migKey =
        recId ||
        (cleanClassName && cleanSecName
          ? `sec_legacy_${cleanClassName.toLowerCase()}|${cleanSecName.toLowerCase()}`
          : '');
      if (!migKey || migratedSecSet.has(migKey)) {
        continue;
      }

      let existingSec = recId ? await SectionModel.findOne({ record_id: recId }) : null;
      if (!existingSec && cleanClassName && cleanSecName) {
        existingSec = await SectionModel.findOne({
          class_name: cleanClassName,
          name: cleanSecName,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingSec) {
        if (recId && !existingSec.record_id) {
          existingSec.record_id = recId;
          await existingSec.save();
        }
      } else if (cleanClassName && cleanSecName) {
        const capVal = Math.max(1, Number(sec.capacity) || 40);
        const doc = new SectionModel({
          ...(recId ? { record_id: recId } : {}),
          name: cleanSecName,
          class_name: cleanClassName,
          capacity: capVal,
          room: sec.room !== undefined ? String(sec.room).trim() : '',
          teacher_name: sec.teacher_name !== undefined ? String(sec.teacher_name).trim() : '',
          created_at: sec.created_at ? new Date(sec.created_at) : new Date(baseMs + idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedSecs.push(migKey);
      migratedSecSet.add(migKey);
    }
  } else if (!secMigrationDoc && (await SectionModel.countDocuments()) === 0) {
    const defaultSections = [
      { record_id: 'sec_01', class_name: 'Grade 9 - Matric', name: 'A', capacity: 45, room: 'Room 101', teacher_name: 'Sir Muhammad Ali' },
      { record_id: 'sec_02', class_name: 'Grade 9 - Matric', name: 'B', capacity: 40, room: 'Room 102', teacher_name: 'Miss Ayesha Siddiqua' },
      { record_id: 'sec_03', class_name: 'Grade 10 - Matric', name: 'A', capacity: 45, room: 'Room 201', teacher_name: 'Prof. Tariq Mahmood' },
      { record_id: 'sec_04', class_name: 'Grade 10 - Matric', name: 'B', capacity: 40, room: 'Room 202', teacher_name: 'Maulana Abdul Rehman' },
    ];
    for (const s of defaultSections) {
      await SectionModel.create(s);
      newlyMigratedSecs.push(s.record_id);
    }
  }

  if (newlyMigratedSecs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'sections' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedSecs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.sections = await SectionModel.countDocuments();

  // 7. Subjects — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const subjMigrationDoc = await DataMigrationModel.findOne({ module_name: 'subjects' }).lean();
  const migratedSubjSet = new Set<string>(subjMigrationDoc?.migrated_keys || []);
  const newlyMigratedSubjs: string[] = [];

  if (Array.isArray(localData?.subjects) && localData.subjects.length > 0) {
    const baseMs = Date.UTC(2026, 0, 10, 8, 20, 0);
    for (let idx = 0; idx < localData.subjects.length; idx++) {
      const s = localData.subjects[idx];
      const recId = s?.id ? String(s.id).trim() : '';
      const cleanClassName = s?.class_name ? String(s.class_name).trim() : '';
      const cleanSubjName = s?.name ? String(s.name).trim() : '';
      const migKey =
        recId ||
        (cleanClassName && cleanSubjName
          ? `sb_legacy_${cleanClassName.toLowerCase()}|${cleanSubjName.toLowerCase()}`
          : '');
      if (!migKey || migratedSubjSet.has(migKey)) {
        continue;
      }

      let existingSubj = recId ? await SubjectModel.findOne({ record_id: recId }) : null;
      if (!existingSubj && cleanClassName && cleanSubjName) {
        existingSubj = await SubjectModel.findOne({
          class_name: cleanClassName,
          name: cleanSubjName,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingSubj) {
        if (recId && !existingSubj.record_id) {
          existingSubj.record_id = recId;
          await existingSubj.save();
        }
      } else if (cleanClassName && cleanSubjName) {
        const periodsVal = Math.max(1, Number(s.weekly_periods) || 5);
        const doc = new SubjectModel({
          ...(recId ? { record_id: recId } : {}),
          class_name: cleanClassName,
          name: cleanSubjName,
          code: s.code ? String(s.code).trim() : '',
          teacher_name: s.teacher_name ? String(s.teacher_name).trim() : '',
          weekly_periods: periodsVal,
          status: s.status === 'Inactive' ? 'Inactive' : 'Active',
          created_at: s.created_at ? new Date(s.created_at) : new Date(baseMs + idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedSubjs.push(migKey);
      migratedSubjSet.add(migKey);
    }
  }

  if (newlyMigratedSubjs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'subjects' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedSubjs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.subjects = await SubjectModel.countDocuments();

  // 8. Timetable — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const ttMigrationDoc = await DataMigrationModel.findOne({ module_name: 'timetable' }).lean();
  const migratedTtSet = new Set<string>(ttMigrationDoc?.migrated_keys || []);
  const newlyMigratedTts: string[] = [];

  if (Array.isArray(localData?.timetable) && localData.timetable.length > 0) {
    const baseMs = Date.UTC(2026, 0, 10, 8, 30, 0);
    for (let idx = 0; idx < localData.timetable.length; idx++) {
      const tt = localData.timetable[idx];
      const recId = tt?.id ? String(tt.id).trim() : '';
      const cleanClassName = tt?.class_name ? String(tt.class_name).trim() : '';
      const cleanSection = tt?.section ? String(tt.section).trim() : 'A';
      const cleanDay = tt?.day ? String(tt.day).trim() : '';
      const cleanStart = tt?.start_time ? String(tt.start_time).trim() : '';
      const cleanEnd = tt?.end_time ? String(tt.end_time).trim() : '';
      const cleanSubject = tt?.subject ? String(tt.subject).trim() : '';
      const migKey =
        recId ||
        (cleanClassName && cleanDay && cleanStart
          ? `tt_legacy_${cleanClassName}|${cleanSection}|${cleanDay}|${cleanStart}|${cleanSubject}`
          : '');
      if (!migKey || migratedTtSet.has(migKey)) {
        continue;
      }

      let existingTt = recId ? await TimetableModel.findOne({ record_id: recId }) : null;
      if (!existingTt && cleanClassName && cleanDay && cleanStart && cleanSubject) {
        existingTt = await TimetableModel.findOne({
          class_name: cleanClassName,
          section: cleanSection,
          day: cleanDay,
          start_time: cleanStart,
          subject: cleanSubject,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingTt) {
        if (recId && !existingTt.record_id) {
          existingTt.record_id = recId;
          await existingTt.save();
        }
      } else if (cleanClassName && cleanDay && cleanStart && cleanEnd && cleanSubject) {
        const doc = new TimetableModel({
          ...(recId ? { record_id: recId } : {}),
          class_name: cleanClassName,
          section: cleanSection,
          subject: cleanSubject,
          teacher_name: tt.teacher_name ? String(tt.teacher_name).trim() : 'Assigned Faculty',
          day: cleanDay as any,
          start_time: cleanStart,
          end_time: cleanEnd,
          room: tt.room ? String(tt.room).trim() : 'Room 101',
          created_at: tt.created_at ? new Date(tt.created_at) : new Date(baseMs + idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedTts.push(migKey);
      migratedTtSet.add(migKey);
    }
  }

  if (newlyMigratedTts.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'timetable' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedTts } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.timetable = await TimetableModel.countDocuments();

  // 9. Exams — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const exMigrationDoc = await DataMigrationModel.findOne({ module_name: 'exams' }).lean();
  const migratedExSet = new Set<string>(exMigrationDoc?.migrated_keys || []);
  const newlyMigratedExs: string[] = [];

  if (Array.isArray(localData?.exams) && localData.exams.length > 0) {
    const baseMs = Date.UTC(2026, 0, 10, 8, 40, 0);
    for (let idx = 0; idx < localData.exams.length; idx++) {
      const ex = localData.exams[idx];
      const recId = ex?.id ? String(ex.id).trim() : '';
      const cleanTitle = ex?.title ? String(ex.title).trim() : '';
      const cleanTerm = ex?.term ? String(ex.term).trim() : 'Mid-Term';
      const cleanStart = ex?.start_date ? String(ex.start_date).trim() : '';
      const migKey =
        recId ||
        (cleanTitle ? `ex_legacy_${cleanTitle.toLowerCase()}|${cleanTerm.toLowerCase()}|${cleanStart}` : '');
      if (!migKey || migratedExSet.has(migKey)) {
        continue;
      }

      let existingEx = recId ? await ExamModel.findOne({ record_id: recId }) : null;
      if (!existingEx && cleanTitle && cleanStart) {
        existingEx = await ExamModel.findOne({
          title: cleanTitle,
          start_date: cleanStart,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingEx) {
        if (recId && !existingEx.record_id) {
          existingEx.record_id = recId;
          await existingEx.save();
        }
      } else if (cleanTitle) {
        const doc = new ExamModel({
          ...(recId ? { record_id: recId } : {}),
          title: cleanTitle,
          term: cleanTerm,
          academic_year: ex.academic_year ? String(ex.academic_year).trim() : '2026-2027',
          start_date: cleanStart || new Date().toISOString().split('T')[0],
          end_date: ex.end_date !== undefined ? String(ex.end_date).trim() : '',
          classes: Array.isArray(ex.classes) && ex.classes.length > 0 ? ex.classes : ['All Classes'],
          status:
            ex.status === 'Ongoing' || ex.status === 'Completed' || ex.status === 'Scheduled'
              ? ex.status
              : 'Scheduled',
          created_at: ex.created_at ? new Date(ex.created_at) : new Date(baseMs + idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedExs.push(migKey);
      migratedExSet.add(migKey);
    }
  }

  if (newlyMigratedExs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'exams' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedExs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.exams = await ExamModel.countDocuments();

  // 10. Results (Authoritative MongoDB Store — Idempotent One-Time Backfill)
  const resMigrationDoc = await DataMigrationModel.findOne({ module_name: 'results' }).lean();
  const migratedResSet = new Set<string>(resMigrationDoc?.migrated_keys || []);
  const newlyMigratedRes: string[] = [];

  if (Array.isArray(localData?.results) && localData.results.length > 0) {
    for (const res of localData.results) {
      if (!res?.exam_id || !res?.student_id) continue;
      const recId = res.id ? String(res.id).trim() : '';
      const migKey = recId || `${String(res.exam_id).trim()}::${String(res.student_id).trim()}`;
      if (migratedResSet.has(migKey)) {
        continue;
      }

      const existingRes = await ResultModel.findOne({
        $or: [
          ...(recId ? [{ record_id: recId }] : []),
          { exam_id: String(res.exam_id).trim(), student_id: String(res.student_id).trim() },
        ],
      });

      if (existingRes) {
        if (recId && !existingRes.record_id) {
          existingRes.record_id = recId;
          await existingRes.save();
        }
      } else {
        const subjects = Array.isArray(res.subjects)
          ? res.subjects.map((s: any) => ({
              subject_name: String(s.subject_name || 'Subject'),
              total_marks: Math.max(1, Number(s.total_marks || 100)),
              obtained_marks: Math.max(0, Number(s.obtained_marks ?? 0)),
              grade: String(s.grade || 'F'),
            }))
          : [];
        const totalMarks =
          Number(res.total_marks) > 0
            ? Number(res.total_marks)
            : Math.max(1, subjects.reduce((sum: number, s: any) => sum + s.total_marks, 0) || 100);
        const obtainedMarks = Math.max(0, Number(res.obtained_marks ?? 0));
        const pct =
          res.percentage !== undefined
            ? Math.min(100, Math.max(0, Number(res.percentage)))
            : parseFloat(((obtainedMarks / totalMarks) * 100).toFixed(1));

        await ResultModel.create({
          ...(recId ? { record_id: recId } : {}),
          exam_id: String(res.exam_id).trim(),
          exam_title: String(res.exam_title || 'Term Assessment').trim(),
          student_id: String(res.student_id).trim(),
          student_name: String(res.student_name || 'Student').trim(),
          class_name: String(res.class_name || 'General').trim(),
          section: String(res.section || 'A').trim(),
          subjects,
          total_marks: totalMarks,
          obtained_marks: obtainedMarks,
          percentage: pct,
          overall_grade: String(res.overall_grade || 'A'),
          remarks: String(res.remarks ?? ''),
          published: res.published !== false,
        });
      }

      newlyMigratedRes.push(migKey);
      migratedResSet.add(migKey);
    }
  }

  if (newlyMigratedRes.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'results' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedRes } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.results = await ResultModel.countDocuments();

  // 11. Fees & Fee Payments (Authoritative MongoDB Store — Idempotent One-Time Backfill)
  const feeMigrationDoc = await DataMigrationModel.findOne({ module_name: 'fees' }).lean();
  const migratedFeeSet = new Set<string>(feeMigrationDoc?.migrated_keys || []);
  const newlyMigratedFees: string[] = [];

  const feePayMigrationDoc = await DataMigrationModel.findOne({ module_name: 'fee_payments' }).lean();
  const migratedFeePaySet = new Set<string>(feePayMigrationDoc?.migrated_keys || []);
  const newlyMigratedFeePays: string[] = [];

  if (Array.isArray(localData?.fees) && localData.fees.length > 0) {
    for (const f of localData.fees) {
      if (!f?.student_id || !f?.fee_month) continue;
      const voucherId = f.id ? String(f.id).trim() : '';
      const cleanMonth = String(f.fee_month).trim();
      const monthKey = cleanMonth.toLowerCase();
      const yr = Number(f.year || 2026);
      const migKey = voucherId || `${String(f.student_id).trim()}::${monthKey}::${yr}`;

      if (!migratedFeeSet.has(migKey)) {
        const escapedMonth = cleanMonth.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingFee = await FeeModel.findOne({
          $or: [
            ...(voucherId ? [{ voucher_id: voucherId }] : []),
            {
              student_id: String(f.student_id).trim(),
              fee_month: { $regex: new RegExp(`^${escapedMonth}$`, 'i') },
              year: yr,
            },
          ],
        });

        if (existingFee) {
          let changed = false;
          if (voucherId && !existingFee.voucher_id) {
            existingFee.voucher_id = voucherId;
            changed = true;
          }
          if (!existingFee.fee_month_key && existingFee.fee_month) {
            existingFee.fee_month_key = String(existingFee.fee_month).trim().toLowerCase();
            changed = true;
          }
          if (changed) {
            await existingFee.save();
          }
        } else {
          const hist = Array.isArray(f.payment_history)
            ? f.payment_history
                .filter((p: any) => p?.receipt_no && Number(p?.amount) > 0)
                .map((p: any) => ({
                  receipt_no: String(p.receipt_no).trim(),
                  date: String(p.date || '2026-09-01'),
                  amount: Number(p.amount),
                  method: p.method || 'Cash',
                  transaction_id: p.transaction_id ? String(p.transaction_id).trim() : '',
                  notes: String(p.notes ?? ''),
                }))
            : [];

          await FeeModel.create({
            ...(voucherId ? { voucher_id: voucherId } : {}),
            student_id: String(f.student_id).trim(),
            student_name: String(f.student_name || 'Student').trim(),
            class_name: String(f.class_name || 'General').trim(),
            fee_month: cleanMonth,
            fee_month_key: monthKey,
            year: yr,
            tuition_fee: Math.max(0, Number(f.tuition_fee ?? 0)),
            admission_fee: Math.max(0, Number(f.admission_fee ?? 0)),
            other_charges: Math.max(0, Number(f.other_charges ?? 0)),
            total_amount: Math.max(0, Number(f.total_amount ?? 0)),
            paid_amount: Math.max(0, Number(f.paid_amount ?? 0)),
            pending_amount: Math.max(0, Number(f.pending_amount ?? 0)),
            due_date: String(f.due_date || `${yr}-09-15`),
            status: ['Paid', 'Unpaid', 'Partial', 'Overdue'].includes(f.status) ? f.status : 'Unpaid',
            payment_history: hist,
          });
        }

        newlyMigratedFees.push(migKey);
        migratedFeeSet.add(migKey);
      }

      if (Array.isArray(f.payment_history)) {
        for (const p of f.payment_history) {
          const receiptNo = p?.receipt_no ? String(p.receipt_no).trim() : '';
          const payAmt = Number(p?.amount || 0);
          if (!receiptNo || payAmt <= 0 || migratedFeePaySet.has(receiptNo)) {
            continue;
          }
          const existingPay = await FeePaymentModel.findOne({ receipt_no: receiptNo }).lean();
          if (!existingPay) {
            const cleanTxn = p.transaction_id ? String(p.transaction_id).trim() : '';
            const allowedMethods = [
              'Cash',
              'Bank Deposit',
              'Bank Transfer',
              'Easypaisa / JazzCash',
              'Online Slip',
            ];
            await FeePaymentModel.create({
              fee_id: voucherId || `${String(f.student_id).trim()}_${monthKey}_${yr}`,
              student_id: String(f.student_id).trim(),
              receipt_no: receiptNo,
              ...(cleanTxn ? { transaction_id: cleanTxn } : {}),
              date: String(p.date || '2026-09-01'),
              amount: payAmt,
              method: allowedMethods.includes(p.method) ? p.method : 'Cash',
              notes: String(p.notes ?? ''),
              received_by: 'System Backfill',
            });
          }
          newlyMigratedFeePays.push(receiptNo);
          migratedFeePaySet.add(receiptNo);
        }
      }
    }
  }

  if (newlyMigratedFees.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'fees' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedFees } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  if (newlyMigratedFeePays.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'fee_payments' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedFeePays } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.fees = await FeeModel.countDocuments();
  counts.fee_payments = await FeePaymentModel.countDocuments();

  // 11b. Attendance (Authoritative MongoDB Store — Idempotent One-Time Backfill)
  const attMigrationDoc = await DataMigrationModel.findOne({ module_name: 'attendance' }).lean();
  const migratedAttSet = new Set<string>(attMigrationDoc?.migrated_keys || []);
  const newlyMigratedAtts: string[] = [];

  if (Array.isArray(localData?.attendance) && localData.attendance.length > 0) {
    for (const att of localData.attendance) {
      if (!att?.student_id || !att?.date) continue;
      const recId = att.id ? String(att.id).trim() : '';
      const cleanStudentId = String(att.student_id).trim();
      const cleanDate = String(att.date).trim();
      const migKey = recId || `${cleanStudentId}::${cleanDate}`;
      if (migratedAttSet.has(migKey)) {
        continue;
      }

      const existingAtt = await AttendanceModel.findOne({
        $or: [
          ...(recId ? [{ record_id: recId }] : []),
          { student_id: cleanStudentId, date: cleanDate },
        ],
      });

      if (existingAtt) {
        if (recId && !existingAtt.record_id) {
          existingAtt.record_id = recId;
          await existingAtt.save();
        }
      } else {
        const validStatus = ['Present', 'Absent', 'Late', 'Leave'].includes(att.status)
          ? att.status
          : 'Present';
        await AttendanceModel.create({
          ...(recId ? { record_id: recId } : {}),
          student_id: cleanStudentId,
          student_name: String(att.student_name || 'Student').trim(),
          class_name: String(att.class_name || 'General').trim(),
          section: String(att.section || 'A').trim(),
          date: cleanDate,
          status: validStatus,
          remarks: String(att.remarks ?? ''),
          marked_by: String(att.marked_by || ''),
        });
      }

      newlyMigratedAtts.push(migKey);
      migratedAttSet.add(migKey);
    }
  }

  if (newlyMigratedAtts.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'attendance' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedAtts } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }

  // 12. Admissions (Authoritative MongoDB Store — Idempotent One-Time Backfill)
  const migrationState = await DataMigrationModel.findOne({ module_name: 'admissions' }).lean();
  const migratedSet = new Set<string>(migrationState?.migrated_keys || []);
  const newlyMigratedKeys: string[] = [];

  if (localData?.admissions?.length) {
    for (const adm of localData.admissions) {
      if (!adm?.application_no) continue;
      const appNo = String(adm.application_no).trim();
      if (migratedSet.has(appNo)) {
        // Already backfilled in a prior run — never overwrite MongoDB edits or resurrect deleted records
        continue;
      }

      const existingAdm = await AdmissionModel.findOne({ application_no: appNo });
      if (existingAdm) {
        let needsSave = false;
        if (!existingAdm.record_id && adm.id) {
          existingAdm.record_id = String(adm.id);
          needsSave = true;
        }
        const computedDedupe = computeAdmissionDedupeKey(
          existingAdm.student_name,
          existingAdm.father_name,
          existingAdm.class_applying,
          existingAdm.status
        );
        if (computedDedupe && !existingAdm.active_dedupe_key) {
          existingAdm.active_dedupe_key = computedDedupe;
          needsSave = true;
        }
        if (needsSave) {
          await existingAdm.save();
        }
      } else {
        const statusVal = adm.status || 'Pending';
        const dedupeKey = computeAdmissionDedupeKey(
          adm.student_name,
          adm.father_name,
          adm.class_applying,
          statusVal
        );
        const doc = new AdmissionModel({
          ...(adm.id ? { record_id: String(adm.id) } : {}),
          application_no: appNo,
          student_name: adm.student_name,
          father_name: adm.father_name,
          dob: adm.dob || '',
          gender: adm.gender || 'Male',
          class_applying: adm.class_applying,
          previous_school: adm.previous_school || '',
          parent_phone: adm.parent_phone,
          parent_email: adm.parent_email || '',
          address: adm.address || '',
          documents: adm.documents || [],
          status: statusVal,
          remarks: adm.remarks || '',
          ...(dedupeKey ? { active_dedupe_key: dedupeKey } : {}),
          created_at: adm.created_at ? new Date(adm.created_at) : new Date(),
        });
        await doc.save();
      }
      newlyMigratedKeys.push(appNo);
      migratedSet.add(appNo);
    }
  }

  if (newlyMigratedKeys.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'admissions' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedKeys } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }

  // Ensure any pre-existing active MongoDB admission documents have active_dedupe_key populated
  const unindexedActiveAdmissions = await AdmissionModel.find({
    status: { $ne: 'Rejected' },
    active_dedupe_key: { $exists: false },
  });
  for (const doc of unindexedActiveAdmissions) {
    const key = computeAdmissionDedupeKey(doc.student_name, doc.father_name, doc.class_applying, doc.status);
    if (key) {
      doc.active_dedupe_key = key;
      await doc.save().catch(() => {});
    }
  }

  counts.admissions = await AdmissionModel.countDocuments();

  // 13. Announcements — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const annMigrationDoc = await DataMigrationModel.findOne({ module_name: 'announcements' }).lean();
  const migratedAnnSet = new Set<string>(annMigrationDoc?.migrated_keys || []);
  const newlyMigratedAnns: string[] = [];

  if (Array.isArray(localData?.announcements) && localData.announcements.length > 0) {
    const baseMs = Date.UTC(2026, 8, 28, 12, 0, 0);
    for (let idx = 0; idx < localData.announcements.length; idx++) {
      const ann = localData.announcements[idx];
      const recId = ann?.id ? String(ann.id).trim() : '';
      const migKey = recId || `ann_legacy_${String(ann?.title || '').trim()}|${String(ann?.date || '').trim()}`;
      if (!migKey || migratedAnnSet.has(migKey)) {
        continue;
      }

      let existingAnn = recId ? await AnnouncementModel.findOne({ record_id: recId }) : null;
      if (!existingAnn && ann?.title) {
        // Attach record_id to pre-Phase-7 seeded document if present, without overwriting updated fields
        existingAnn = await AnnouncementModel.findOne({
          title: ann.title,
          date: ann.date || '',
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingAnn) {
        if (recId && !existingAnn.record_id) {
          existingAnn.record_id = recId;
          await existingAnn.save();
        }
      } else if (ann?.title && ann?.content) {
        const doc = new AnnouncementModel({
          ...(recId ? { record_id: recId } : {}),
          title: String(ann.title).trim(),
          content: String(ann.content),
          category: ann.category || 'General',
          audience: ann.audience || 'All',
          date: ann.date || new Date().toISOString().split('T')[0],
          priority: ann.priority || 'Normal',
          author: ann.author || 'Administration',
          published: ann.published !== false,
          created_at: ann.created_at ? new Date(ann.created_at) : new Date(baseMs - idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedAnns.push(migKey);
      migratedAnnSet.add(migKey);
    }
  }

  if (newlyMigratedAnns.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'announcements' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedAnns } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.announcements = await AnnouncementModel.countDocuments();

  // 14. Events — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const evMigrationDoc = await DataMigrationModel.findOne({ module_name: 'events' }).lean();
  const migratedEvSet = new Set<string>(evMigrationDoc?.migrated_keys || []);
  const newlyMigratedEvs: string[] = [];

  if (Array.isArray(localData?.events) && localData.events.length > 0) {
    const baseMs = Date.UTC(2026, 8, 28, 12, 0, 0);
    for (let idx = 0; idx < localData.events.length; idx++) {
      const ev = localData.events[idx];
      const recId = ev?.id ? String(ev.id).trim() : '';
      const migKey = recId || `ev_legacy_${String(ev?.title || '').trim()}|${String(ev?.date || '').trim()}`;
      if (!migKey || migratedEvSet.has(migKey)) {
        continue;
      }

      let existingEv = recId ? await SchoolEventModel.findOne({ record_id: recId }) : null;
      if (!existingEv && ev?.title) {
        existingEv = await SchoolEventModel.findOne({
          title: ev.title,
          date: ev.date || '',
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingEv) {
        if (recId && !existingEv.record_id) {
          existingEv.record_id = recId;
          await existingEv.save();
        }
      } else if (ev?.title && ev?.date) {
        const doc = new SchoolEventModel({
          ...(recId ? { record_id: recId } : {}),
          title: String(ev.title).trim(),
          description: ev.description !== undefined ? String(ev.description) : '',
          date: String(ev.date),
          time: ev.time || '09:00 AM',
          location: ev.location || 'Campus Grounds, Paharpur',
          cover_image: ev.cover_image || '/src/assets/images/hero_school_campus_1790606578302.jpg',
          status: ev.status || 'Upcoming',
          category: ev.category || 'General',
          created_at: ev.created_at ? new Date(ev.created_at) : new Date(baseMs + idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedEvs.push(migKey);
      migratedEvSet.add(migKey);
    }
  }

  if (newlyMigratedEvs.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'events' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedEvs } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.events = await SchoolEventModel.countDocuments();

  // 15. Gallery — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const galMigrationDoc = await DataMigrationModel.findOne({ module_name: 'gallery' }).lean();
  const migratedGalSet = new Set<string>(galMigrationDoc?.migrated_keys || []);
  const newlyMigratedGals: string[] = [];

  if (Array.isArray(localData?.gallery) && localData.gallery.length > 0) {
    const baseMs = Date.UTC(2026, 8, 28, 12, 0, 0);
    for (let idx = 0; idx < localData.gallery.length; idx++) {
      const gal = localData.gallery[idx];
      const recId = gal?.id ? String(gal.id).trim() : '';
      const migKey = recId || `gal_legacy_${String(gal?.title || '').trim()}|${String(gal?.image_url || '').trim()}`;
      if (!migKey || migratedGalSet.has(migKey)) {
        continue;
      }

      let existingGal = recId ? await GalleryModel.findOne({ record_id: recId }) : null;
      if (!existingGal && gal?.title && gal?.image_url) {
        existingGal = await GalleryModel.findOne({
          title: gal.title,
          image_url: gal.image_url,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingGal) {
        if (recId && !existingGal.record_id) {
          existingGal.record_id = recId;
          await existingGal.save();
        }
      } else if (gal?.title && gal?.image_url) {
        const doc = new GalleryModel({
          ...(recId ? { record_id: recId } : {}),
          title: String(gal.title).trim(),
          caption: gal.caption !== undefined ? String(gal.caption) : '',
          category: gal.category || 'Campus',
          image_url: String(gal.image_url).trim(),
          date: gal.date || new Date().toISOString().split('T')[0],
          created_at: gal.created_at ? new Date(gal.created_at) : new Date(baseMs - idx * 1000),
        });
        await doc.save();
      }

      newlyMigratedGals.push(migKey);
      migratedGalSet.add(migKey);
    }
  }

  if (newlyMigratedGals.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'gallery' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedGals } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.gallery = await GalleryModel.countDocuments();

  // 16. Contact Messages — Idempotent One-Time Backfill (Authoritative MongoDB Store)
  const cmMigrationDoc = await DataMigrationModel.findOne({ module_name: 'contact_messages' }).lean();
  const migratedCmSet = new Set<string>(cmMigrationDoc?.migrated_keys || []);
  const newlyMigratedCms: string[] = [];

  if (Array.isArray(localData?.contact_messages) && localData.contact_messages.length > 0) {
    const baseMs = Date.UTC(2026, 8, 28, 12, 0, 0);
    for (let idx = 0; idx < localData.contact_messages.length; idx++) {
      const cm = localData.contact_messages[idx];
      const recId = cm?.id ? String(cm.id).trim() : '';
      const migKey =
        recId ||
        `cm_legacy_${String(cm?.name || '').trim()}|${String(cm?.created_at || '').trim()}|${String(cm?.subject || '').trim()}`;
      if (!migKey || migratedCmSet.has(migKey)) {
        continue;
      }

      let existingCm = recId ? await ContactMessageModel.findOne({ record_id: recId }) : null;
      if (!existingCm && cm?.name && cm?.message) {
        existingCm = await ContactMessageModel.findOne({
          name: cm.name,
          message: cm.message,
          $or: [{ record_id: { $exists: false } }, { record_id: null }, { record_id: '' }],
        });
      }

      if (existingCm) {
        if (recId && !existingCm.record_id) {
          existingCm.record_id = recId;
          await existingCm.save();
        }
      } else if (cm?.name && cm?.message) {
        const parsedCreated = cm.created_at ? new Date(cm.created_at) : new Date(baseMs - idx * 1000);
        const doc = new ContactMessageModel({
          ...(recId ? { record_id: recId } : {}),
          name: String(cm.name).trim(),
          email: cm.email ? String(cm.email).trim().toLowerCase() : '',
          phone: cm.phone ? String(cm.phone).trim() : '',
          subject: cm.subject ? String(cm.subject).trim() : 'General Inquiry',
          message: String(cm.message),
          read: Boolean(cm.read),
          replied: Boolean(cm.replied),
          created_at: isNaN(parsedCreated.getTime()) ? new Date(baseMs - idx * 1000) : parsedCreated,
        });
        await doc.save();
      }

      newlyMigratedCms.push(migKey);
      migratedCmSet.add(migKey);
    }
  }

  if (newlyMigratedCms.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'contact_messages' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedCms } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.contact_messages = await ContactMessageModel.countDocuments();

  // 17. School Settings — Idempotent One-Time Backfill (Authoritative MongoDB Store, Preserves Unknown Legacy Fields)
  const settingsMigrationDoc = await DataMigrationModel.findOne({ module_name: 'school_settings' }).lean();
  const migratedSettingsSet = new Set<string>(settingsMigrationDoc?.migrated_keys || []);

  if (!migratedSettingsSet.has('default')) {
    const blockedKeys = new Set([
      '_id',
      '__v',
      'singleton_key',
      'created_at',
      'updated_at',
      '__proto__',
      'constructor',
      'prototype',
    ]);
    const safeLocalSettings: Record<string, any> = {};
    if (localData?.settings && typeof localData.settings === 'object' && !Array.isArray(localData.settings)) {
      for (const [key, val] of Object.entries(localData.settings)) {
        if (!blockedKeys.has(key) && !key.startsWith('$') && val !== undefined) {
          safeLocalSettings[key] = val;
        }
      }
    }

    const mergedInitialSettings: Record<string, any> = {
      ...DEFAULT_SCHOOL_SETTINGS,
      ...safeLocalSettings,
    };

    const rawExistingSettings = await SchoolSettingsModel.collection.findOne({});
    if (!rawExistingSettings) {
      await SchoolSettingsModel.findOneAndUpdate(
        { singleton_key: 'default' },
        {
          $set: {
            singleton_key: 'default',
            ...mergedInitialSettings,
          },
        },
        { upsert: true, returnDocument: 'after', strict: false }
      );
    } else {
      // Backfill only missing keys (such as features, academic_levels, facilities, testimonials, or custom legacy fields)
      // without overwriting fields already stored in MongoDB
      const patchMissing: Record<string, any> = {};
      if (!rawExistingSettings.singleton_key) {
        patchMissing.singleton_key = 'default';
      }
      for (const [key, val] of Object.entries(mergedInitialSettings)) {
        if (rawExistingSettings[key] === undefined) {
          patchMissing[key] = val;
        }
      }
      if (Object.keys(patchMissing).length > 0) {
        await SchoolSettingsModel.updateOne(
          { _id: rawExistingSettings._id },
          { $set: patchMissing },
          { strict: false }
        );
      }
    }

    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'school_settings' },
      {
        $addToSet: { migrated_keys: 'default' },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }
  counts.settings = await SchoolSettingsModel.countDocuments();

  // 18. Ensure Core Operational Records — Idempotent One-Time Backfill (Never Overwrite Edits or Resurrect Deleted Records)
  const coreIdentityMigrationDoc = await DataMigrationModel.findOne({
    module_name: 'core_operational_identities',
  }).lean();
  const migratedCoreIdentitySet = new Set<string>(coreIdentityMigrationDoc?.migrated_keys || []);
  const newlyMigratedCoreIdentities: string[] = [];

  if (!migratedCoreIdentitySet.has('ahmad_khan')) {
    let existingAhmad = await StudentModel.findOne({
      $or: [{ record_id: 'std_ahmad_khan' }, { admission_no: 'ADM-2026-015' }],
    });
    if (existingAhmad) {
      if (!existingAhmad.record_id) {
        existingAhmad.record_id = 'std_ahmad_khan';
        await existingAhmad.save();
      }
    } else {
      existingAhmad = await StudentModel.create({
        record_id: 'std_ahmad_khan',
        admission_no: 'ADM-2026-015',
        roll_no: '102',
        full_name: 'Ahmad Khan',
        father_name: 'Tariq Khan',
        dob: '2010-04-12',
        gender: 'Male',
        class_name: 'Grade 9 - Matric',
        section: 'A',
        contact_no: '+92 300 9876543',
        emergency_contact: '+92 301 7766554',
        address: 'Main Bazar, Paharpur, D.I. Khan',
        admission_date: '2026-01-10',
        academic_status: 'Active',
      });
      const existingEnr = await EnrollmentModel.findOne({
        student_id: existingAhmad.record_id || existingAhmad._id.toString(),
        academic_year: '2026-2027',
        status: 'Active',
      });
      if (!existingEnr) {
        const sid = existingAhmad.record_id || existingAhmad._id.toString();
        await EnrollmentModel.create({
          record_id: 'enr_ahmad_khan_2026',
          student_id: sid,
          class_name: 'Grade 9 - Matric',
          section: 'A',
          academic_year: '2026-2027',
          enrolled_date: '2026-01-10',
          status: 'Active',
          active_enrollment_key: computeActiveEnrollmentKey(sid, '2026-2027', 'Active'),
        });
      }
    }
    newlyMigratedCoreIdentities.push('ahmad_khan');
    migratedCoreIdentitySet.add('ahmad_khan');
  }

  if (!migratedCoreIdentitySet.has('muhammad_ali')) {
    const existingAli = await TeacherModel.findOne({
      $or: [{ record_id: 'tch_muhammad_ali' }, { email: 'muhammad.ali@shawanschool.edu.pk' }],
    });
    if (existingAli) {
      if (!existingAli.record_id) {
        existingAli.record_id = 'tch_muhammad_ali';
        await existingAli.save();
      }
    } else {
      await TeacherModel.create({
        record_id: 'tch_muhammad_ali',
        name: 'Sir Muhammad Ali',
        qualification: 'M.Sc Physics (Peshawar University), B.Ed',
        subject: 'Physics & Applied Sciences',
        classes: ['Grade 9 - Matric', 'Grade 10 - Matric', '1st Year F.Sc'],
        contact_no: '+92 301 5551234',
        email: 'muhammad.ali@shawanschool.edu.pk',
        joining_date: '2023-08-15',
        experience: '7 Years Experience',
        status: 'Active',
        bio: 'Senior Physics and Sciences instructor specializing in matric and intermediate board curricula.',
      });
    }
    newlyMigratedCoreIdentities.push('muhammad_ali');
    migratedCoreIdentitySet.add('muhammad_ali');
  }

  const ahmadStudent = await StudentModel.findOne({
    $or: [{ record_id: 'std_ahmad_khan' }, { admission_no: 'ADM-2026-015' }],
  });

  if (!migratedCoreIdentitySet.has('tariq_khan')) {
    if (ahmadStudent) {
      const ahmadCanonicalId = ahmadStudent.record_id || ahmadStudent._id.toString();
      const existingTariq = await ParentModel.findOne({
        $or: [{ record_id: 'prt_tariq_khan' }, { email: 'tariq.khan@gmail.com' }],
      });
      if (existingTariq) {
        if (!existingTariq.record_id) {
          existingTariq.record_id = 'prt_tariq_khan';
          await existingTariq.save();
        }
      } else {
        await ParentModel.create({
          record_id: 'prt_tariq_khan',
          user_id: 'usr_tariq_khan',
          name: 'Tariq Khan',
          father_name: 'Haji Ghulam Khan',
          phone: '+92 300 9876543',
          email: 'tariq.khan@gmail.com',
          address: 'Paharpur, Dera Ismail Khan, KP',
          occupation: 'Local Business Owner / Merchant',
          linked_students: Array.from(
            new Set([ahmadCanonicalId, ahmadStudent._id.toString(), ahmadStudent.admission_no])
          ),
        });
      }
    }
    newlyMigratedCoreIdentities.push('tariq_khan');
    migratedCoreIdentitySet.add('tariq_khan');
  }

  if (newlyMigratedCoreIdentities.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'core_operational_identities' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedCoreIdentities } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }

  counts.students = await StudentModel.countDocuments();
  counts.teachers = await TeacherModel.countDocuments();
  counts.parents = await ParentModel.countDocuments();
  counts.enrollments = await EnrollmentModel.countDocuments();

  // 18b. Core Operational Academic & Financial Records — Idempotent One-Time Backfill
  const coreAcadMigrationDoc = await DataMigrationModel.findOne({
    module_name: 'core_operational_academics',
  }).lean();
  const migratedCoreAcadSet = new Set<string>(coreAcadMigrationDoc?.migrated_keys || []);
  const newlyMigratedCoreAcad: string[] = [];

  if (ahmadStudent) {
    const ahmadCanonicalId = ahmadStudent.record_id || ahmadStudent._id.toString();
    const ahmadIdCandidates = Array.from(new Set([ahmadCanonicalId, ahmadStudent._id.toString()]));

    if (!migratedCoreAcadSet.has('ahmad_fee_sep_2026')) {
      const existingAhmadFee = await FeeModel.findOne({
        $or: [
          { voucher_id: 'fee_ahmad_sep_2026' },
          { student_id: { $in: ahmadIdCandidates }, fee_month: 'September', year: 2026 },
        ],
      });
      if (existingAhmadFee) {
        let changed = false;
        if (!existingAhmadFee.voucher_id) {
          existingAhmadFee.voucher_id = 'fee_ahmad_sep_2026';
          changed = true;
        }
        if (!existingAhmadFee.fee_month_key) {
          existingAhmadFee.fee_month_key = 'september';
          changed = true;
        }
        if (changed) {
          await existingAhmadFee.save();
        }
      } else {
        await FeeModel.create({
          voucher_id: 'fee_ahmad_sep_2026',
          student_id: ahmadCanonicalId,
          student_name: ahmadStudent.full_name,
          class_name: ahmadStudent.class_name,
          fee_month: 'September',
          fee_month_key: 'september',
          year: 2026,
          tuition_fee: 3500,
          admission_fee: 0,
          other_charges: 0,
          total_amount: 3500,
          paid_amount: 0,
          pending_amount: 3500,
          due_date: '2026-09-25',
          status: 'Unpaid',
          payment_history: [],
        });
      }
      newlyMigratedCoreAcad.push('ahmad_fee_sep_2026');
      migratedCoreAcadSet.add('ahmad_fee_sep_2026');
    }

    if (!migratedCoreAcadSet.has('ahmad_result_mid_2026')) {
      const existingAhmadResult = await ResultModel.findOne({
        $or: [
          { record_id: 'res_ahmad_mid_2026' },
          { exam_id: 'EXAM-2026-MID', student_id: { $in: ahmadIdCandidates } },
        ],
      });
      if (existingAhmadResult) {
        if (!existingAhmadResult.record_id) {
          existingAhmadResult.record_id = 'res_ahmad_mid_2026';
          await existingAhmadResult.save();
        }
      } else {
        await ResultModel.create({
          record_id: 'res_ahmad_mid_2026',
          exam_id: 'EXAM-2026-MID',
          exam_title: 'Mid-Term Examination 2026',
          student_id: ahmadCanonicalId,
          student_name: ahmadStudent.full_name,
          class_name: ahmadStudent.class_name,
          section: ahmadStudent.section || 'A',
          subjects: [
            { subject_name: 'English Language', total_marks: 100, obtained_marks: 78, grade: 'B' },
            { subject_name: 'Urdu Literature', total_marks: 100, obtained_marks: 82, grade: 'A' },
            { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 74, grade: 'B' },
            { subject_name: 'Physics & Applied Sciences', total_marks: 100, obtained_marks: 79, grade: 'B' },
            { subject_name: 'Islamiyat & Quranic Translation', total_marks: 50, obtained_marks: 44, grade: 'A' },
          ],
          total_marks: 450,
          obtained_marks: 357,
          percentage: 79.3,
          overall_grade: 'B',
          remarks: 'Good academic comprehension; attendance requires immediate improvement to meet 75% threshold.',
          published: true,
        });
      }
      newlyMigratedCoreAcad.push('ahmad_result_mid_2026');
      migratedCoreAcadSet.add('ahmad_result_mid_2026');
    }

    if (!migratedCoreAcadSet.has('ahmad_attendance_seed')) {
      const ahmadDates = [
        '2026-09-15',
        '2026-09-16',
        '2026-09-17',
        '2026-09-18',
        '2026-09-19',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
      ];
      const absentSet = new Set(['2026-09-17', '2026-09-23', '2026-09-29', '2026-10-01']);

      for (const d of ahmadDates) {
        const recId = `att_ahmad_${d.replace(/-/g, '')}`;
        const existingAtt = await AttendanceModel.findOne({
          $or: [
            { record_id: recId },
            { student_id: { $in: ahmadIdCandidates }, date: d },
          ],
        });
        if (existingAtt) {
          if (!existingAtt.record_id) {
            existingAtt.record_id = recId;
            await existingAtt.save();
          }
        } else {
          const status = absentSet.has(d) ? 'Absent' : 'Present';
          await AttendanceModel.create({
            record_id: recId,
            student_id: ahmadCanonicalId,
            student_name: ahmadStudent.full_name,
            class_name: ahmadStudent.class_name,
            section: ahmadStudent.section || 'A',
            date: d,
            status,
            remarks: status === 'Absent' ? 'Uninformed absent' : 'Present in class',
            marked_by: 'Class Incharge',
          });
        }
      }
      newlyMigratedCoreAcad.push('ahmad_attendance_seed');
      migratedCoreAcadSet.add('ahmad_attendance_seed');
    }
  }

  if (newlyMigratedCoreAcad.length > 0) {
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'core_operational_academics' },
      {
        $addToSet: { migrated_keys: { $each: newlyMigratedCoreAcad } },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }

  // 19. Legacy Audit Logs — One-Time Idempotent Backfill
  const auditMigrationDoc = await DataMigrationModel.findOne({ module_name: 'audit_logs' }).lean();
  const migratedAuditSet = new Set<string>(auditMigrationDoc?.migrated_keys || []);
  if (!migratedAuditSet.has('legacy_audit_logs_v1')) {
    if (Array.isArray(localData?.audit_logs) && localData.audit_logs.length > 0) {
      const existingAuditCount = await AuditLogModel.countDocuments();
      if (existingAuditCount === 0) {
        const batch = localData.audit_logs.slice(0, 200).map((entry: any) => ({
          user_id: String(entry.user_id || 'system'),
          user_name: String(entry.user_name || 'System'),
          user_role: String(entry.user_role || 'admin'),
          action: String(entry.action || 'Legacy Action'),
          target_type: String(entry.target_type || 'System'),
          target_id: String(entry.target_id || ''),
          details: String(entry.details || ''),
          timestamp: String(entry.timestamp || new Date().toISOString()),
          created_at: entry.timestamp && !isNaN(new Date(entry.timestamp).getTime())
            ? new Date(entry.timestamp)
            : new Date(),
        }));
        if (batch.length > 0) {
          await AuditLogModel.insertMany(batch, { ordered: false }).catch(() => {});
        }
      }
    }
    await DataMigrationModel.findOneAndUpdate(
      { module_name: 'audit_logs' },
      {
        $addToSet: { migrated_keys: 'legacy_audit_logs_v1' },
        $set: { last_run_at: new Date() },
      },
      { upsert: true }
    );
  }

  counts.fees = await FeeModel.countDocuments();
  counts.results = await ResultModel.countDocuments();
  counts.attendance = await AttendanceModel.countDocuments();
  counts.audit_logs = await AuditLogModel.countDocuments();

  console.log('[Mongo Seed] MongoDB Atlas collections seeded and verified successfully:', counts);
  return { success: true, counts };
}
