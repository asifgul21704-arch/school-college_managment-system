import { TeacherAssignmentModel } from './models/TeacherAssignment.ts';
import { isClassAssignedToTeacher, normalizeClassAccessLabel } from './classAccess.ts';

export interface TeacherAssignmentScope {
  class_name: string;
  section: string;
  subject: string;
}

function normalizeSectionLabel(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  return normalizeClassAccessLabel(raw.startsWith('section ') ? raw.slice(8) : raw);
}

function normalizeSubjectLabel(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().split(' ').filter(Boolean).join(' ');
}

export async function getTeacherAssignmentScopes(teacherIds: string[]): Promise<TeacherAssignmentScope[]> {
  if (teacherIds.length === 0) return [];
  const assignments = await TeacherAssignmentModel.find({
    teacher_id: { $in: teacherIds },
  }).select('class_name section subject').lean();
  return assignments.map((assignment: any) => ({
    class_name: String(assignment.class_name || ''),
    section: String(assignment.section || ''),
    subject: String(assignment.subject || ''),
  }));
}

export function isTeacherAssignedToClassSection(
  teacherClasses: string[],
  assignments: TeacherAssignmentScope[],
  className: string,
  section: string
): boolean {
  if (!isClassAssignedToTeacher(teacherClasses || [], className)) return false;
  const classAssignments = assignments.filter(assignment =>
    isClassAssignedToTeacher([assignment.class_name], className)
  );
  // Older teacher profiles may have class-level assignments without section rows.
  if (classAssignments.length === 0) return true;
  const targetSection = normalizeSectionLabel(section);
  if (!targetSection) return false;
  return classAssignments.some(
    assignment => normalizeSectionLabel(assignment.section) === targetSection
  );
}

export function isTeacherSubjectAssigned(
  teacherSubject: unknown,
  assignmentSubjects: unknown[],
  requestedSubject: unknown
): boolean {
  const requested = normalizeSubjectLabel(requestedSubject);
  if (!requested) return false;
  const allowed = [teacherSubject, ...assignmentSubjects]
    .flatMap(value => String(value ?? '').split(/[,/&]/))
    .map(normalizeSubjectLabel)
    .filter(Boolean);
  return allowed.includes(requested);
}

export async function canAssignTeacherHomework(
  teacher: { id: string; classes: string[]; subject: string },
  teacherIds: string[],
  className: string,
  section: string,
  subject: string
): Promise<boolean> {
  const assignments = await getTeacherAssignmentScopes(teacherIds);
  if (!isTeacherAssignedToClassSection(teacher.classes || [], assignments, className, section)) {
    return false;
  }
  const matchingAssignments = assignments.filter(assignment =>
    isClassAssignedToTeacher([assignment.class_name], className) &&
    normalizeSectionLabel(assignment.section) === normalizeSectionLabel(section)
  );
  return isTeacherSubjectAssigned(
    teacher.subject,
    matchingAssignments.map(assignment => assignment.subject),
    subject
  );
}
