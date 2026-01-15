import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { resolveAvatarUrl } from '../services/dataService';
import { clearWorkspaceCache } from '../services/noraChatService';

interface UserProfile {
  // Explicitly requested by the user: include an avatarUrl resolved from Supabase storage or direct URL.
  // Reasoning: The header needs a ready-to-use URL without duplicating URL resolution logic in the UI.
  avatarUrl: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Flag to prevent race condition between initialize() and onAuthStateChange()
    let isInitializing = true;
    
    // Check active session and associated profile, then keep both in sync with auth state.
    // Explicitly requested by the user: augment the context with a resolved avatar URL for the Header component.
    const fetchProfile = async (authUserId: string): Promise<UserProfile | null> => {
      try {
        // Pull the minimal fields we need; RLS should allow selecting the current user's profile by auth_user_id.
        //
        // IMPORTANT (explicit per user request):
        // In this project, we observed `profiles.avatar_url` is NOT available (PostgREST returns 400).
        // We therefore rely on `profiles.avatar_img_path` which can be either:
        // - a full Supabase Storage URL (often /storage/v1/object/public/...)
        // - a bucket/path reference
        const { data: prof, error } = await supabase
          .from('profiles')
          .select('avatar_img_path, display_name, first_name, last_name')
          .eq('auth_user_id', authUserId)
          .maybeSingle();

        if (error) {
          console.warn('Failed to fetch profile:', error.message);
          return null;
        }

        /**
         * resolveAvatar
         *
         * Explicit per user request:
         * - We STORE `profiles.avatar_img_path` as just an object path:
         *   `<workspaceId>/<userId>/<file>`
         * - We DISPLAY by generating a URL from the fixed bucket `clients-info`:
         *   `supabase.storage.from('clients-info').createSignedUrl(avatar_img_path, ...)`
         *
         * Backward compatibility (assistant decision):
         * - If `avatar_img_path` is a full Supabase Storage URL, we extract bucket/path and sign that.
         * - If it is `bucket/path`, we treat it as legacy ONLY when the bucket looks like a real bucket
         *   (e.g. "clients-info", "public-bucket"), not when it looks like a UUID workspace id.
         */
        const resolveAvatar = async (): Promise<string | null> => {
          const raw: string | null =
            (prof as any)?.avatar_img_path ??
            null;
          if (!raw) return null;
          const trimmed = String(raw).trim();
          if (!trimmed) return null;

          const DEFAULT_AVATAR_BUCKET = 'clients-info';

          const looksLikeUuid = (s: string): boolean =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

          // Helper: attempt to extract <bucket>/<objectPath> from a Supabase Storage URL.
          const extractFromStorageUrl = (urlStr: string): { bucket: string; objectPath: string } | null => {
            try {
              const u = new URL(urlStr);
              // Match both public + signed URL forms.
              const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
              if (!m) return null;
              return { bucket: m[1], objectPath: decodeURIComponent(m[2]) };
            } catch {
              return null;
            }
          };

          const signOrPublicUrl = async (bucket: string, objectPath: string): Promise<string | null> => {
            if (!bucket || !objectPath) return null;
            const { data: signed, error: signErr } = await supabase.storage
              .from(bucket)
              // 7 days; keeps UI stable while still rotating URLs
              .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
            if (!signErr && signed?.signedUrl) return signed.signedUrl;
            console.warn(
              'Avatar signed URL failed; falling back to public URL:',
              signErr?.message ?? signErr
            );
            const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
            return data?.publicUrl ?? null;
          };

          // Case 1: full URL that looks like Supabase Storage -> sign using extracted bucket/path
          if (/^https?:\/\//i.test(trimmed)) {
            const parts = extractFromStorageUrl(trimmed);
            if (parts) {
              const url = await signOrPublicUrl(parts.bucket, parts.objectPath);
              return url ?? trimmed;
            }
            // External URL (not Supabase storage) -> return as-is
            return trimmed;
          }

          // Case 2: object path (new contract): <workspaceId>/<userId>/<file> stored in `clients-info`
          // We treat anything that looks like "<uuid>/<uuid>/..." as an object path, NOT as "bucket/path".
          const parts = trimmed.split('/');
          if (parts.length >= 3 && looksLikeUuid(parts[0]) && looksLikeUuid(parts[1])) {
            return await signOrPublicUrl(DEFAULT_AVATAR_BUCKET, trimmed);
          }

          // Case 3 (legacy): "bucket/path" where bucket is a known real bucket name.
          // (If it's not a known bucket, we assume it's the new object path stored without bucket.)
          if (parts.length >= 2) {
            const bucket = parts[0];
            const objectPath = parts.slice(1).join('/');
            const knownBuckets = new Set<string>([
              DEFAULT_AVATAR_BUCKET,
              'public-bucket',
              'client-website-img',
            ]);
            if (knownBuckets.has(bucket)) {
              return await signOrPublicUrl(bucket, objectPath);
            }
          }

          // Fallback: treat as object path in default avatar bucket (best-effort).
          // (We keep resolveAvatarUrl as the last resort to preserve historical behavior.)
          return (
            (await signOrPublicUrl(DEFAULT_AVATAR_BUCKET, trimmed)) ??
            resolveAvatarUrl(trimmed)
          );
        };

        const avatarUrl = await resolveAvatar();
        return {
          avatarUrl,
          displayName: (prof as any)?.display_name ?? null,
          firstName: (prof as any)?.first_name ?? null,
          lastName: (prof as any)?.last_name ?? null,
        };
      } catch (error) {
        console.error('Profile fetch error:', error);
        return null;
      }
    };

    const initialize = async () => {
      console.log('🔄 Auth: Initializing...');
      setLoading(true);
      
      try {
        console.log('🔄 Auth: Getting session...');
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        console.log('✅ Auth: Session retrieved:', session ? 'active' : 'no session');
        
        if (sessionError) {
          console.error('❌ Auth: Session error:', sessionError);
          setSession(null);
          setUser(null);
          setProfile(null);
          return;
        }
        
        setSession(session);
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        
        if (currentUser) {
          console.log('🔄 Auth: Fetching profile for user', currentUser.id.substring(0, 8) + '...');
          const p = await fetchProfile(currentUser.id);
          console.log('✅ Auth: Profile fetched:', p?.displayName || 'no display name');
          setProfile(p);
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error('❌ Auth: Initialization error:', error);
        setSession(null);
        setUser(null);
        setProfile(null);
      } finally {
        isInitializing = false; // Mark initialization as complete
        console.log('✅ Auth: Initialization complete - setting loading=false');
        setLoading(false);
      }
    };

    initialize();

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip if we're still in the initial load to prevent race condition
      if (isInitializing) {
        console.log('⏭️  Auth: Skipping onAuthStateChange during initialization (event:', event + ')');
        return;
      }
      
      console.log('🔔 Auth: onAuthStateChange event:', event);
      
      // Set session/user state IMMEDIATELY (no await) - this unblocks supabase client
      setSession(session);
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      
      if (currentUser) {
        // Fire-and-forget: DON'T block the auth state change handler
        // This prevents supabase.functions.invoke() from hanging
        console.log('🔄 Auth: onAuthStateChange fetching profile (non-blocking)...');
        fetchProfile(currentUser.id)
          .then(p => {
            console.log('✅ Auth: onAuthStateChange profile fetched');
            setProfile(p);
          })
          .catch(err => {
            console.error('❌ Auth: Profile fetch error:', err);
          })
          .finally(() => {
            console.log('✅ Auth: onAuthStateChange complete - setting loading=false');
            setLoading(false);
          });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // Clear cached workspace data to prevent stale data for next user
    clearWorkspaceCache();
    
    // supabase.auth.signOut() returns { error }, it doesn't throw
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.warn('SignOut API failed, trying local signout:', error);
      await supabase.auth.signOut({ scope: 'local' });
    }
    
    // Explicitly clear local state in case onAuthStateChange doesn't fire
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};