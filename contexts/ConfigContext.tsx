import React, { createContext, useContext, useState, useEffect } from 'react';
import { DatabaseSchema, AppConfig, User, ChatLog } from '../types';
import { supabase } from '../services/supabaseClient';
import { PERSONA } from '../constants';

interface LoginResult {
  success: boolean;
  message?: string;
}

interface ConfigContextType {
  db: DatabaseSchema;
  currentUser: User | null;
  isAdmin: boolean;
  loginClient: (key: string) => Promise<LoginResult>;
  loginAdmin: (username: string, key: string) => Promise<LoginResult>;
  logout: () => void;
  updateGlobalConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
  addUser: (user: User) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  addApiKey: (key: string) => Promise<void>;
  removeApiKey: (key: string) => Promise<void>;
  // New Chat History Methods
  saveChatLog: (role: 'user' | 'model', content: string) => Promise<void>;
  fetchChatLogs: () => Promise<ChatLog[]>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

// Default app config fallback
const DEFAULT_CONFIG: AppConfig = {
    aiName: 'CentralGPT',
    aiPersona: PERSONA,
    devName: 'XdpzQ',
    apiKeys: [],
    avatarUrl: ''
};

// Maximum allowed hours for a client session (changed from 24 to 200000)
const MAX_HOURS = 200000;

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<DatabaseSchema>({ users: [], globalConfig: DEFAULT_CONFIG });
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // 1. Fetch Data & Subscribe to Realtime Changes
  useEffect(() => {
    const fetchData = async () => {
        try {
            // Fetch Config
            const { data: configData } = await supabase.from('app_config').select('*').single();
            // Fetch Users
            const { data: usersData } = await supabase.from('users').select('*');

            setDb({
                globalConfig: configData ? {
                    aiName: configData.ai_name,
                    aiPersona: configData.ai_persona || PERSONA,
                    devName: configData.dev_name,
                    apiKeys: configData.api_keys || [],
                    avatarUrl: configData.avatar_url
                } : DEFAULT_CONFIG,
                users: (usersData || []).map((u: any) => ({
                    id: u.id,
                    username: u.username,
                    accessKey: u.access_key,
                    role: u.role,
                    createdAt: u.created_at,
                    profile: u.profile,
                    config: u.config
                }))
            });
        } catch (error) {
            console.error("Failed to fetch data, using defaults", error);
        }
    };

    fetchData();

    // Real-time Subscription
    const channels = supabase.channel('custom-all-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        fetchData(); 
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, (payload) => {
        fetchData(); 
    })
    .subscribe();

    return () => {
        supabase.removeChannel(channels);
    };
  }, []);

  // 2. Persistent Session Logic
  useEffect(() => {
      const restoreSession = async () => {
          const savedSessionKey = localStorage.getItem('central_gpt_active_session');
          if (!savedSessionKey) return;

          const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('access_key', savedSessionKey)
            .single();

          if (error || !user) {
              localStorage.removeItem('central_gpt_active_session');
              return;
          }

          const mappedUser: User = {
            id: user.id,
            username: user.username,
            accessKey: user.access_key,
            role: user.role,
            createdAt: user.created_at,
            profile: user.profile,
            config: user.config
          };

          if (user.role === 'admin') {
              setCurrentUser(mappedUser);
          } else {
              // 200,000 Hour Check (previously 24 hours)
              const now = new Date();
              const created = new Date(user.created_at);
              const diffMs = now.getTime() - created.getTime();
              const diffHours = diffMs / (1000 * 60 * 60);

              if (diffHours < MAX_HOURS) {
                  setCurrentUser(mappedUser);
              } else {
                  localStorage.removeItem('central_gpt_active_session');
              }
          }
      };
      restoreSession();
  }, []);

  const loginClient = async (key: string): Promise<LoginResult> => {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('access_key', key)
        .eq('role', 'user')
        .single();

    if (error || !user) {
      return { success: false, message: 'Invalid Access Key.' };
    }

    const now = new Date();
    const created = new Date(user.created_at);
    const diffMs = now.getTime() - created.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours >= MAX_HOURS) {
      return { success: false, message: Access Key has expired (${MAX_HOURS}h limit reached). };
    }

    const mappedUser: User = {
        id: user.id,
        username: user.username,
        accessKey: user.access_key,
        role: user.role,
        createdAt: user.created_at,
        profile: user.profile,
        config: user.config
    };

    setCurrentUser(mappedUser);
    localStorage.setItem('central_gpt_active_session', key);
    return { success: true };
  };

  const loginAdmin = async (username: string, key: string): Promise<LoginResult> => {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('access_key', key) 
        .eq('role', 'admin')
        .single();
    
    if (user) {
      const mappedUser: User = {
          id: user.id,
          username: user.username,
          accessKey: user.access_key,
          role: user.role,
          createdAt: user.created_at,
          profile: user.profile,
          config: user.config
      };
      setCurrentUser(mappedUser);
      localStorage.setItem('central_gpt_active_session', key);
      return { success: true };
    }
    return { success: false, message: 'Invalid Admin Credentials.' };
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem('central_gpt_active_session');
  };

  const updateGlobalConfig = async (newConfig: Partial<AppConfig>) => {
    const dbUpdate: any = {};
    if (newConfig.aiName) dbUpdate.ai_name = newConfig.aiName;
    if (newConfig.devName) dbUpdate.dev_name = newConfig.devName;
    if (newConfig.avatarUrl) dbUpdate.avatar_url = newConfig.avatarUrl;
    if (newConfig.apiKeys) dbUpdate.api_keys = newConfig.apiKeys;

    await supabase.from('app_config').update(dbUpdate).eq('id', 1);
  };

  const addUser = async (user: User) => {
    const { error } = await supabase.from('users').insert({
        username: user.username,
        access_key: user.accessKey,
        role: user.role,
        created_at: user.createdAt,
        profile: user.profile,
        config: user.config
    });
    
    if (error) {
        alert("Error adding user to Supabase: " + error.message);
    }
  };

  const deleteUser = async (id: string) => {
    await supabase.from('users').delete().eq('id', id);
  };

  const addApiKey = async (key: string) => {
    const currentKeys = db.globalConfig.apiKeys;
    await supabase.from('app_config').update({
        api_keys: [...currentKeys, key]
    }).eq('id', 1);
  };

  const removeApiKey = async (keyToRemove: string) => {
    const currentKeys = db.globalConfig.apiKeys;
    await supabase.from('app_config').update({
        api_keys: currentKeys.filter(k => k !== keyToRemove)
    }).eq('id', 1);
  };

  // Chat History Implementation
  const saveChatLog = async (role: 'user' | 'model', content: string) => {
    if (!currentUser) return;
    await supabase.from('chat_logs').insert({
        user_id: currentUser.id,
        role: role,
        content: content,
        created_at: new Date().toISOString()
    });
  };

  const fetchChatLogs = async (): Promise<ChatLog[]> => {
    if (!currentUser) return [];
    const { data, error } = await supabase
        .from('chat_logs')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: true });
    
    if (error || !data) return [];

    return data.map((item: any) => ({
        id: item.id,
        userId: item.user_id,
        role: item.role,
        content: item.content,
        createdAt: item.created_at
    }));
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <ConfigContext.Provider value={{ 
      db, 
      currentUser, 
      isAdmin, 
      loginClient,
      loginAdmin,
      logout,
      updateGlobalConfig,
      addUser,
      deleteUser,
      addApiKey,
      removeApiKey,
      saveChatLog,
      fetchChatLogs
    }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
