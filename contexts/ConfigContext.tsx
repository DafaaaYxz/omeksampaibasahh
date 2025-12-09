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
  saveChatLog: (role: 'user' | 'model', content: string) => Promise<void>;
  fetchChatLogs: () => Promise<ChatLog[]>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

const DEFAULT_CONFIG: AppConfig = {
  aiName: 'CentralGPT',
  aiPersona: PERSONA,
  devName: 'XdpzQ',
  apiKeys: [],
  avatarUrl: ''
};

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<DatabaseSchema>({ users: [], globalConfig: DEFAULT_CONFIG });
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: configData } = await supabase.from('app_config').select('*').single();
        const { data: usersData } = await supabase.from('users').select('*');

        setDb({
          globalConfig: configData
            ? {
                aiName: configData.ai_name,
                aiPersona: configData.ai_persona || PERSONA,
                devName: configData.dev_name,
                apiKeys: configData.api_keys || [],
                avatarUrl: configData.avatar_url
              }
            : DEFAULT_CONFIG,
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

    const channels = supabase
      .channel('custom-all-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(channels);
    };
  }, []);

  // Restore session (200.000 jam)
  useEffect(() => {
    const restoreSession = async () => {
      const savedSessionKey = localStorage.getItem('central_gpt_active_session');
      if (!savedSessionKey) return;

      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('access_key', savedSessionKey)
        .single();

      if (!user) {
        localStorage.removeItem('central_gpt_active_session');
        return;
      }

      const now = new Date();
      const created = new Date(user.created_at);
      const diffMs = now.getTime() - created.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      // 200.000 jam
      if (diffHours >= 200000 && user.role !== 'admin') {
        localStorage.removeItem('central_gpt_active_session');
        return;
      }

      const mapped: User = {
        id: user.id,
        username: user.username,
        accessKey: user.access_key,
        role: user.role,
        createdAt: user.created_at,
        profile: user.profile,
        config: user.config
      };

      setCurrentUser(mapped);
    };

    restoreSession();
  }, []);

  // LOGIN CLIENT (200.000 jam)
  const loginClient = async (key: string): Promise<LoginResult> => {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('access_key', key)
      .eq('role', 'user')
      .single();

    if (!user) return { success: false, message: 'Invalid Access Key.' };

    const now = new Date();
    const created = new Date(user.created_at);
    const diffHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);

    if (diffHours >= 200000) {
      return { success: false, message: 'Access Key expired (200.000 hours).' };
    }

    const mapped: User = {
      id: user.id,
      username: user.username,
      accessKey: user.access_key,
      role: user.role,
      createdAt: user.created_at,
      profile: user.profile,
      config: user.config
    };

    setCurrentUser(mapped);
    localStorage.setItem('central_gpt_active_session', key);

    return { success: true };
  };

  const loginAdmin = async (username: string, key: string): Promise<LoginResult> => {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('access_key', key)
      .eq('role', 'admin')
      .single();

    if (!user) return { success: false, message: 'Invalid Admin Credentials.' };

    const mapped: User = {
      id: user.id,
      username: user.username,
      accessKey: user.access_key,
      role: user.role,
      createdAt: user.created_at,
      profile: user.profile,
      config: user.config
    };

    setCurrentUser(mapped);
    localStorage.setItem('central_gpt_active_session', key);

    return { success: true };
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

    if (error) alert("Error adding user: " + error.message);
  };

  const deleteUser = async (id: string) => {
    await supabase.from('users').delete().eq('id', id);
  };

  const addApiKey = async (key: string) => {
    await supabase.from('app_config').update({
      api_keys: [...db.globalConfig.apiKeys, key]
    }).eq('id', 1);
  };

  const removeApiKey = async (keyToRemove: string) => {
    await supabase.from('app_config').update({
      api_keys: db.globalConfig.apiKeys.filter(k => k !== keyToRemove)
    }).eq('id', 1);
  };

  const saveChatLog = async (role: 'user' | 'model', content: string) => {
    if (!currentUser) return;
    await supabase.from('chat_logs').insert({
      user_id: currentUser.id,
      role,
      content,
      created_at: new Date().toISOString()
    });
  };

  const fetchChatLogs = async (): Promise<ChatLog[]> => {
    if (!currentUser) return [];
    const { data } = await supabase
      .from('chat_logs')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });

    return (
      data?.map((item: any) => ({
        id: item.id,
        userId: item.user_id,
        role: item.role,
        content: item.content,
        createdAt: item.created_at
      })) || []
    );
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <ConfigContext.Provider
      value={{
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
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) throw new Error('useConfig must be used within a ConfigProvider');
  return context;
};
