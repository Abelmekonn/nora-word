import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Clock, LogOut, Languages } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface HeaderProps {
  onNewChat?: () => void;
  onHistory?: () => void;
  disableNewChat?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onNewChat, onHistory, disableNewChat }) => {
  const { user, profile, signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  /**
   * User menu open state.
   * Explicit per user request: profile icon is clickable/hoverable and shows a dropdown.
   * Reasoning (assistant's decision): we support hover AND click because hover can be unreliable
   * inside Office add-ins / touch environments.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);

  /**
   * Fallback: first letter of email (or 'U').
   * Explicit per user request: show fallback letter if no avatar.
   */
  const fallbackLetter = useMemo(() => {
    const email = user?.email ?? '';
    return email ? email[0].toUpperCase() : 'U';
  }, [user?.email]);

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const root = menuRootRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [menuOpen]);

  return (
    <div className="h-14 px-4 flex items-center justify-between bg-white/50 backdrop-blur-md shrink-0 border-b border-white/30 z-20">
      <div className="flex items-center gap-3">
        {/* Logo Image */}
        <img 
          src="https://htbkflogiaxswzpxtsoz.supabase.co/storage/v1/object/public/public-bucket/20250821_2222_Liquid%20Glass%20Butterfly_remix_01k37s7h0qf1ba89p92bytpzkz.png" 
          alt={String(t('header.logoAlt'))} 
          className="w-7 h-7 object-contain drop-shadow-sm"
        />
        <span className="font-semibold text-slate-800 text-sm tracking-tight">{String(t('header.brandName'))}</span>
      </div>
      
      <div className="flex items-center gap-3 text-slate-500">
        <button
          onClick={onNewChat}
          aria-label={String(t('header.createNewChat'))}
          title={String(t('header.createNewChat'))}
          className="hover:text-indigo-600 hover:bg-white/40 p-1.5 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!!disableNewChat}
        >
          <Plus size={18} />
        </button>
        <button
          onClick={onHistory}
          aria-label={String(t('header.viewHistory'))}
          title={String(t('header.viewHistory'))}
          className="hover:text-indigo-600 hover:bg-white/40 p-1.5 rounded-full transition-all"
        >
          <Clock size={18} />
        </button>

        {/* Profile / user menu (top-right) */}
        <div
          ref={menuRootRef}
          className="relative"
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            aria-label={String(t('header.userMenu'))}
            aria-haspopup="true"
            aria-expanded={menuOpen ? 'true' : 'false'}
            title={user?.email || String(t('header.userMenu'))}
            onClick={() => setMenuOpen((v) => !v)}
            className="w-9 h-9 rounded-full bg-white/70 border border-white/60 overflow-hidden hover:bg-white/90 transition-colors flex items-center justify-center text-slate-700 font-bold text-sm shadow-sm ring-1 ring-slate-200/60"
          >
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={user?.email || String(t('header.userFallback'))}
                className="w-full h-full object-cover"
              />
            ) : (
              fallbackLetter
            )}
          </button>
          
          {/* Dropdown Menu with Language Selector */}
          <div
            role="menu"
            aria-label={String(t('header.userMenu'))}
            className={`absolute right-0 top-full mt-2 w-44 bg-white backdrop-blur-xl rounded-lg shadow-xl border border-white/40 transition-all z-50 ${
              menuOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible -translate-y-1'
            }`}
          >
            {/* Language Selector */}
            <div className="px-3 py-2 border-b border-white/30">
              <div className="flex items-center gap-2 mb-1">
                <Languages size={12} className="text-slate-500" />
                <span className="text-[10px] text-slate-500 font-medium">{String(t('language.label'))}</span>
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'en' | 'fr' | 'nl')}
                className="w-full text-xs bg-white/60 border border-white/60 rounded px-2 py-1 text-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <option value="en">{String(t('language.english'))}</option>
                <option value="fr">{String(t('language.french'))}</option>
                <option value="nl">{String(t('language.dutch'))}</option>
              </select>
            </div>
            
            {/* Sign Out Button */}
            <button
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
              role="menuitem"
              aria-label={String(t('header.signOut'))}
              className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-white/50 flex items-center gap-2 rounded-b-lg"
            >
              <LogOut size={12} /> {String(t('header.signOut'))}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};