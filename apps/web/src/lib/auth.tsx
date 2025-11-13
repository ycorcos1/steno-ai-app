import axios from "axios";

// Import axios directly for fallback requests
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export interface User {
  id: string;
  email: string;
  created_at: string;
}

type NullableUser = User | null;

interface AuthContextValue {
  user: NullableUser;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<NullableUser>;
  signup: (email: string, password: string) => Promise<NullableUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<NullableUser>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add interceptor to include Authorization header if token is in localStorage (fallback)
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("auth_token");
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add Idempotency-Key header for POST, PUT, PATCH requests
    if (["POST", "PUT", "PATCH"].includes(config.method?.toUpperCase() || "")) {
      if (!config.headers["Idempotency-Key"]) {
        // Generate a UUID v4 for idempotency key
        const idempotencyKey = crypto.randomUUID();
        config.headers["Idempotency-Key"] = idempotencyKey;
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Suppress console errors for expected 401 responses (when checking auth status)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Don't log 401 errors to console - they're expected when checking auth status
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      // Silently return the error so it can be handled by the calling code
      return Promise.reject(error);
    }
    // Log other errors normally
    return Promise.reject(error);
  }
);

const extractMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; error?: string }
      | undefined;
    return (
      data?.message ??
      data?.error ??
      error.response?.statusText ??
      error.message ??
      "Request failed"
    );
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong";
};

const parseUser = (data: unknown): User => {
  const candidate = (data as { user?: User })?.user ?? data;
  if (
    candidate &&
    typeof candidate === "object" &&
    "id" in candidate &&
    "email" in candidate &&
    "created_at" in candidate
  ) {
    return candidate as User;
  }

  throw new Error("Invalid user response");
};

const getCurrentUser = async (): Promise<NullableUser> => {
  try {
    const response = await api.get("/auth/me");
    return parseUser(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      // If cookie-based auth failed, try using token from localStorage as fallback
      const token = localStorage.getItem("auth_token");
      if (token) {
        try {
          // Try again with Authorization header
          const retryResponse = await axios.get(`${API_BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            withCredentials: true,
          });
          return parseUser(retryResponse.data);
        } catch (retryError) {
          // If that also fails, clear the token and return null
          localStorage.removeItem("auth_token");
          return null;
        }
      }
      return null;
    }

    throw error;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<NullableUser>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async (): Promise<NullableUser> => {
    setError(null);
    try {
      const current = await getCurrentUser();
      setUser(current);
      return current;
    } catch (err) {
      setError(extractMessage(err));
      throw err;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const current = await getCurrentUser();
        if (isMounted) {
          setUser(current);
        }
      } catch (err) {
        if (isMounted) {
          setError(extractMessage(err));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const login = useCallback(
    async (email: string, password: string): Promise<NullableUser> => {
      setError(null);
      try {
        const response = await api.post("/auth/login", { email, password });
        // If token is in response body (fallback if cookie doesn't work), store it
        if (response.data?.token) {
          localStorage.setItem("auth_token", response.data.token);
        }
        const current = await getCurrentUser();
        setUser(current);
        return current;
      } catch (err) {
        const message = extractMessage(err);
        setError(message);
        throw new Error(message);
      }
    },
    []
  );

  const signup = useCallback(
    async (email: string, password: string): Promise<NullableUser> => {
      setError(null);
      try {
        const response = await api.post("/auth/signup", { email, password });
        // If token is in response body (fallback if cookie doesn't work), store it
        if (response.data?.token) {
          localStorage.setItem("auth_token", response.data.token);
        }
        const current = await getCurrentUser();
        setUser(current);
        return current;
      } catch (err) {
        const message = extractMessage(err);
        setError(message);
        throw new Error(message);
      }
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await api.post("/auth/logout");
    } finally {
      localStorage.removeItem("auth_token"); // Clear token from localStorage too
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      login,
      signup,
      logout,
      refreshUser: async () => {
        try {
          return await refreshUser();
        } catch {
          return null;
        }
      },
      clearError,
    }),
    [clearError, error, loading, login, logout, refreshUser, signup, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return ctx;
};

export const authApi = api;
