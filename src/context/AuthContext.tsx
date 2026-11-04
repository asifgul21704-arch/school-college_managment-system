import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Student, Teacher } from '../types';
import { api, establishAuthenticatedSession, removeStoredToken } from '../services/api';

interface AuthContextType {
  user: User | null;
  studentProfile: Student | null;
  teacherProfile: Teacher | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [studentProfile, setStudentProfile] = useState<Student | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    try {
      const data = await api.getCurrentUser();
      setUser(data.user);
      setStudentProfile(data.studentProfile || null);
      setTeacherProfile(data.teacherProfile || null);
    } catch {
      removeStoredToken();
      setUser(null);
      setStudentProfile(null);
      setTeacherProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, pass: string): Promise<User> => {
    const res = await api.login(email, pass);
    const hydrated = await establishAuthenticatedSession(res.token);
    setUser(hydrated.user);
    setStudentProfile(hydrated.studentProfile || null);
    setTeacherProfile(hydrated.teacherProfile || null);
    return hydrated.user;
  };

  const logout = () => {
    api.logout().catch(() => {});
    removeStoredToken();
    setUser(null);
    setStudentProfile(null);
    setTeacherProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        studentProfile,
        teacherProfile,
        loading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
