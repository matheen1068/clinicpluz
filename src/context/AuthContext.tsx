import React, { createContext, useContext, useState, useEffect } from 'react';
import { StaffUser, UserRole } from '../types/clinic';
import { initialStaffUsers } from '../data/mockClinicData';

const AUTH_STORAGE_KEY = 'cp_auth_session_v1';
const USERS_STORAGE_KEY = 'cp_staff_users_v1';

interface AuthContextType {
  currentUser: StaffUser | null;
  allStaffUsers: StaffUser[];
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  login: (email: string, password?: string) => { success: boolean; error?: string };
  loginAsUser: (userId: string) => void;
  loginAsRole: (role: UserRole) => void;
  logout: () => void;
  updateCurrentUser: (updates: Partial<StaffUser>) => void;
  registerStaff: (user: Omit<StaffUser, 'id'>) => StaffUser;
  canAccessTab: (tabId: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allStaffUsers, setAllStaffUsers] = useState<StaffUser[]>(() => {
    try {
      const saved = localStorage.getItem(USERS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : initialStaffUsers;
    } catch {
      return initialStaffUsers;
    }
  });

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(() => {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
      // Default to initial Admin user for seamless clinic operation
      return initialStaffUsers[0];
    } catch {
      return initialStaffUsers[0];
    }
  });

  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (currentUser) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (e) {
      console.error('Failed to persist auth session', e);
    }
  }, [currentUser]);

  useEffect(() => {
    try {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(allStaffUsers));
    } catch (e) {
      console.error('Failed to persist staff users', e);
    }
  }, [allStaffUsers]);

  const login = (email: string, _password?: string): { success: boolean; error?: string } => {
    const trimmedEmail = email.trim().toLowerCase();
    const found = allStaffUsers.find((u) => u.email.toLowerCase() === trimmedEmail);
    if (!found) {
      return {
        success: false,
        error: 'No registered clinic staff account found with this email address.',
      };
    }
    setCurrentUser(found);
    setIsAuthModalOpen(false);
    return { success: true };
  };

  const loginAsUser = (userId: string) => {
    const found = allStaffUsers.find((u) => u.id === userId);
    if (found) {
      setCurrentUser(found);
      setIsAuthModalOpen(false);
    }
  };

  const loginAsRole = (role: UserRole) => {
    const found = allStaffUsers.find((u) => u.role === role);
    if (found) {
      setCurrentUser(found);
      setIsAuthModalOpen(false);
    }
  };

  const logout = () => {
    setCurrentUser(null);
  };

  const updateCurrentUser = (updates: Partial<StaffUser>) => {
    if (!currentUser) return;
    const updated: StaffUser = { ...currentUser, ...updates };
    setCurrentUser(updated);
    setAllStaffUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  };

  const registerStaff = (user: Omit<StaffUser, 'id'>): StaffUser => {
    const newUser: StaffUser = {
      ...user,
      id: `USER-${Date.now().toString(36).toUpperCase()}`,
    };
    setAllStaffUsers((prev) => [...prev, newUser]);
    setCurrentUser(newUser);
    setIsAuthModalOpen(false);
    return newUser;
  };

  // Role based access logic
  const canAccessTab = (tabId: string): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'Admin') return true;

    switch (tabId) {
      case 'dashboard':
        // All staff can view clinical history
        return true;
      case 'patients':
        return ['Admin', 'Receptionist', 'Doctor'].includes(currentUser.role);
      case 'appointments':
        return ['Admin', 'Receptionist', 'Doctor'].includes(currentUser.role);
      case 'prescriptions':
        return ['Admin', 'Doctor'].includes(currentUser.role);
      case 'reports':
        return ['Admin', 'LabTechnician', 'Doctor'].includes(currentUser.role);
      case 'billing':
        return ['Admin', 'Receptionist'].includes(currentUser.role);
      case 'reminders':
        return ['Admin', 'Receptionist'].includes(currentUser.role);
      default:
        return true;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        allStaffUsers,
        isAuthenticated: !!currentUser,
        isAuthModalOpen,
        setIsAuthModalOpen,
        login,
        loginAsUser,
        loginAsRole,
        logout,
        updateCurrentUser,
        registerStaff,
        canAccessTab,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
