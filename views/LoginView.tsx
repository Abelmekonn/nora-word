import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Button } from '../components/Button';
import { useLanguage } from '../context/LanguageContext';
import { Languages } from 'lucide-react';

export const LoginView: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const { language, setLanguage, t } = useLanguage();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) {
          console.log("error while sign in", error);
          throw error;
        }
        setMessage({ type: 'success', text: t('login.messageSuccess') });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (error: any) {
      console.error("Auth error:", error);
      if (isSignUp) {
        const msg = String(error?.message || '').toLowerCase();
        if ((msg.includes('already') && (msg.includes('registered') || msg.includes('exists'))) || msg.includes('user already registered')) {
          setMessage({ type: 'error', text: String(t('login.messageEmailAlreadyRegistered')) });
        } else {
          setMessage({ type: 'error', text: error.message || String(t('login.messageErrorGeneric')) });
        }
      } else {
        setMessage({ type: 'error', text: error.message || String(t('login.messageErrorGeneric')) });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 bg-transparent">
      <div className="w-full bg-white/40 backdrop-blur-md border border-white/50 rounded-3xl p-8 shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 mb-4 bg-white/50 rounded-full flex items-center justify-center shadow-sm p-3 backdrop-blur-md border border-white/60">
             <img 
               src="https://htbkflogiaxswzpxtsoz.supabase.co/storage/v1/object/public/public-bucket/20250821_2222_Liquid%20Glass%20Butterfly_remix_01k37s7h0qf1ba89p92bytpzkz.png" 
               alt="Nora Legal Logo" 
               className="w-full h-full object-contain drop-shadow-md"
             />
          </div>
          <h1 className="text-2xl font-serif font-bold text-slate-800 tracking-tight" style={{ fontFamily: "'Inter', sans-serif" }}>{String(t('login.brandTitle'))}</h1>
          <p className="text-sm text-slate-600 mt-1">{String(t('login.brandSubtitle'))}</p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-1 ml-1">{String(t('login.emailLabel'))}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-white/60 border border-white/60 rounded-xl focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400 outline-none text-sm transition-all placeholder:text-slate-400"
              placeholder={String(t('login.emailPlaceholder'))}
              required
            />
          </div>
          
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-1 ml-1">{String(t('login.passwordLabel'))}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-white/60 border border-white/60 rounded-xl focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400 outline-none text-sm transition-all placeholder:text-slate-400"
              placeholder={String(t('login.passwordPlaceholder'))}
              required
            />
          </div>

          {message && (
            <div className={`text-xs p-3 rounded-xl border ${message.type === 'error' ? 'bg-red-50/80 border-red-100 text-red-600' : 'bg-green-50/80 border-green-100 text-green-600'}`}>
              {message.text}
            </div>
          )}

          <Button type="submit" isLoading={loading} className="w-full justify-center shadow-lg shadow-slate-400/20 py-2.5 rounded-xl">
            {isSignUp ? String(t('login.createAccount')) : String(t('login.signIn'))}
          </Button>
        </form>

        <div className="mt-6 text-center flex flex-col gap-3">
          {!isSignUp && (
            <button
              onClick={() => window.open('https://nora.legal', '_blank')}
              className="text-xs text-slate-500 hover:text-indigo-600 transition-colors font-medium"
            >
              {String(t('login.requestDemo'))}
            </button>
          )}

          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setMessage(null);
            }}
            className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            {isSignUp ? String(t('login.backToSignIn')) : String(t('login.toggleToSignUp'))}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Languages size={16} className="text-slate-500" />
          <label htmlFor="lang" className="text-xs text-slate-500">{String(t('language.label'))}</label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'en' | 'fr' | 'nl')}
            className="text-xs bg-white/60 border border-white/60 rounded-lg px-2 py-1 text-slate-700"
          >
            <option value="en">{String(t('language.english'))}</option>
            <option value="fr">{String(t('language.french'))}</option>
            <option value="nl">{String(t('language.dutch'))}</option>
          </select>
        </div>
      </div>
      
      <p className="mt-8 text-[10px] text-slate-400 text-center font-medium opacity-70">
        &copy; {new Date().getFullYear()} Nora Legal. {String(t('login.footer'))}
      </p>
    </div>
  );
};
