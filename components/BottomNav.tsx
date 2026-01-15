import React from 'react';
import { ViewState } from '../types';
import { MessageSquare, Zap, BookOpen } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface BottomNavProps {
  currentView: ViewState;
  onViewChange: (view: ViewState) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentView, onViewChange }) => {
  const { t } = useLanguage();
  
  const navItems = [
    { id: ViewState.ASSISTANT, icon: MessageSquare, label: String(t('bottomNav.assistant')) },
    { id: ViewState.ACTIONS, icon: Zap, label: String(t('bottomNav.skills')) },
    { id: ViewState.PLAYBOOKS, icon: BookOpen, label: String(t('bottomNav.agents')) },
  ];

  return (
    <div className="relative shrink-0 z-20">
      {/* Apple-style subtle background with refined blur and border */}
      <div className="absolute inset-0 bg-white/80 backdrop-blur-xl border-t border-black/5"></div>
      
      {/* Navigation container with proper spacing */}
      <div className="relative h-[72px] pb-2 pt-1 flex items-center justify-between px-3">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`
                flex flex-col items-center justify-center 
                flex-1 h-full min-h-[44px] 
                relative
                transition-all duration-300 ease-out
                active:scale-[0.96]
                ${isActive 
                  ? 'text-slate-800' 
                  : 'text-slate-500 active:text-slate-700'
                }
                ${(item as any).className || ''}
              `}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* Icon container with refined sizing and smooth transitions */}
              <div className={`
                relative mb-1
                transition-all duration-300 ease-out
                ${isActive ? 'scale-105' : 'scale-100'}
              `}>
                <item.icon 
                  size={22} 
                  className={`
                    transition-all duration-300 ease-out
                    ${isActive 
                      ? 'fill-slate-800 stroke-slate-800' 
                      : 'fill-transparent stroke-slate-500'
                    }
                  `} 
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </div>
              
              {/* Label with refined typography - Apple SF Pro style */}
              <span className={`
                text-[11px] leading-tight tracking-tight
                transition-all duration-300 ease-out
                ${isActive 
                  ? 'font-semibold text-slate-800' 
                  : 'font-medium text-slate-500'
                }
              `}>
                {item.label}
              </span>
              
              {/* Subtle active state background - Apple-style pill shape */}
              {isActive && (
                <div className="absolute inset-x-2 top-1 bottom-1 bg-slate-100/60 rounded-lg -z-10 transition-opacity duration-300" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};