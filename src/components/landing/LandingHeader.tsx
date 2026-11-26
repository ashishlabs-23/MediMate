import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { NAV_LINKS } from './landingData';
import { ThemeToggle } from '../ui/ThemeToggle';

export function LandingHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header
      role="banner"
      className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-slate-200 transition-colors"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
        {/* Brand logo */}
        <Link
          to="/"
          aria-label="MediMate Home"
          className="inline-flex items-center gap-3 min-h-[44px] min-w-[44px] px-1 rounded-btn text-ink-primary font-bold text-2xl tracking-tight hover:text-brand-teal transition-colors"
        >
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-teal to-teal-500 text-white shadow-md shadow-brand-teal/20"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 21s-7-4.5-9-9.5C1.5 7.5 4.2 4 7.8 4c2 0 3.5 1 4.2 2.2C12.7 5 14.2 4 16.2 4 19.8 4 22.5 7.5 21 11.5 19 16.5 12 21 12 21z" />
              <path d="M12 9v5" />
              <path d="M9.5 11.5h5" />
            </svg>
          </span>
          <span className="font-extrabold tracking-tight">MediMate</span>
        </Link>

        {/* Desktop navigation */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1.5 lg:gap-3">
          {NAV_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3.5 rounded-btn text-sm font-medium text-ink-secondary hover:text-brand-teal hover:bg-slate-100 transition-colors"
            >
              {item.label}
            </a>
          ))}

          {/* Theme switcher */}
          <div className="ml-2 pl-2 border-l border-slate-200">
            <ThemeToggle />
          </div>

          <Link
            to="/login"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 rounded-btn text-sm font-semibold text-ink-primary hover:text-brand-teal hover:bg-slate-100 transition-colors"
          >
            Sign In
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-brand-teal text-sm font-semibold text-white hover:bg-brand-teal-dark active:scale-[0.98] transition-all shadow-md shadow-brand-teal/20"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile menu and theme toggle */}
        <div className="flex md:hidden items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-landing-nav"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-btn border border-slate-300 bg-surface text-ink-primary hover:bg-slate-50 transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile collapsible navigation drawer */}
      <nav
        id="mobile-landing-nav"
        aria-label="Mobile navigation"
        hidden={!mobileMenuOpen}
        className={mobileMenuOpen ? 'md:hidden border-t border-slate-200 bg-surface px-4 py-5' : 'hidden'}
      >
        <div className="flex flex-col gap-2.5">
          {NAV_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center min-h-[44px] min-w-[44px] px-3.5 rounded-btn text-base font-medium text-ink-secondary hover:text-brand-teal hover:bg-slate-100 transition-colors"
            >
              {item.label}
            </a>
          ))}
          <div className="pt-2 border-t border-slate-200 flex flex-col gap-2">
            <Link
              to="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 rounded-btn border border-slate-300 bg-surface text-base font-semibold text-ink-primary hover:bg-slate-50 transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-5 py-3 rounded-xl bg-brand-teal text-base font-semibold text-white hover:bg-brand-teal-dark transition-colors shadow-md shadow-brand-teal/20"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}

export default LandingHeader;
