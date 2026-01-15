import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import nl from '../locales/nl.json';

/**
 * LanguageContext
 *
 * This file was created explicitly per the user's request to add a "Language dropdown"
 * to the login view and enable switching the Word Add-In language. The design choices
 * below aim to keep things lightweight and localized to the Login view for now:
 * - LocalStorage is used so the selected language persists across reloads.
 * - A very small `t(key)` translator is provided with dot-path resolution.
 * - Only `en`, `fr`, and `nl` are supported at the moment, as requested.
 *
 * Future maintainers:
 * - To add more languages, create a new JSON file in `locales/` and register it in `dictionaries`.
 * - To extend translations app-wide, wrap the entire app in this provider (already done in App.tsx)
 *   and use `t()` anywhere user-facing strings are rendered.
 */

type SupportedLanguage = 'en' | 'fr' | 'nl';

type Dictionary = Record<string, any>;

const dictionaries: Record<SupportedLanguage, Dictionary> = {
  en,
  fr,
  nl,
};

interface LanguageContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'nora.language';

function getFromDictionary(dictionary: Dictionary, key: string): string {
  // Resolve dot-path keys, e.g., "login.emailLabel"
  const parts = key.split('.');
  let current: any = dictionary;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return key; // Fallback to key if path is invalid
    }
    current = current[part];
  }
  if (current == null) {
    return key; // Fallback if not found
  }
  if (typeof current !== 'string') {
    // Non-string translations are not supported in this minimal setup
    return key;
  }
  return current;
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>('en');

  useEffect(() => {
    // Load preferred language from localStorage on mount
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY) as SupportedLanguage | null;
      if (stored && ['en', 'fr', 'nl'].includes(stored)) {
        setLanguageState(stored);
      }
    } catch {
      // Ignore storage errors; keep default 'en'
    }
  }, []);

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setLanguageState(lang);
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, lang);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const dictionary = dictionaries[language] ?? dictionaries.en;
    const t = (key: string) => getFromDictionary(dictionary, key);
    return { language, setLanguage, t };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}


