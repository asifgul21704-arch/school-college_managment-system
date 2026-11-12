import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');

function routeBetween(startMarker: string, endMarker: string): string {
  const start = routes.indexOf(startMarker);
  const end = routes.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not locate route section: ${startMarker}`);
  return routes.slice(start, end);
}

test('teacher dashboard reads student, attendance and result data with assigned-class database scope', () => {
  const route = routeBetween("router.get('/teacher/dashboard'", "// 20.2 Teacher Profile");
  assert.match(route, /StudentModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
  assert.match(route, /AttendanceModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
  assert.match(route, /ResultModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
});

test('teacher class overview scopes classes, sections, students and attendance in MongoDB', () => {
  const route = routeBetween("router.get('/teacher/classes'", "// 20.4 Student Roster");
  assert.match(route, /ClassModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
  assert.match(route, /SectionModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
  assert.match(route, /StudentModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
  assert.match(route, /AttendanceModel\.find\(\{ date: todayDate, \.\.\.buildTeacherClassFilter\(assignedClasses\) \}\)/);
});

test('teacher roster and attendance history are database-scoped before DTO mapping', () => {
  const roster = routeBetween("router.get('/teacher/students'", "// 20.5 Attendance Management");
  assert.match(roster, /StudentModel\.find\(studentFilter\)/);
  assert.match(roster, /const studentFilter = buildTeacherClassFilter\(assignedClasses\)/);

  const attendance = routeBetween("router.get('/teacher/attendance'", "router.post('/teacher/attendance'");
  assert.match(attendance, /AttendanceModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
});

test('teacher results query is database-scoped to assigned classes', () => {
  const route = routeBetween("router.get('/teacher/results'", "// 20.7");
  assert.match(route, /ResultModel\.find\(buildTeacherClassFilter\(assignedClasses\)\)/);
});
