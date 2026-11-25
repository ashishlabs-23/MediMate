import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { NAV_LINKS } from './landingData';

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
      className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-slate-200"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <Link
          to="/"
          aria-label="MediMate Home"
          className="inline-flex items-center gap-2.5 min-h-[44px] min-w-[44px] px-1 rounded-btn text-ink-primary font-bold text-xl tracking-tight hover:text-brand-teal transition-colors"
        >
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-brand-teal text-white shadow-sm"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 21s-7-4.5-9-9.5C1.5 7.5 4.2 4 7.8 4c2 0 3.5 1 4.2 2.2C12.7 5 14.2 4 16.2 4 19.8 4 22.5 7.5 21 11.5 19 16.5 12 21 12 21z" />
              <path d="M12 9v5" />
              <path d="M9.5 11.5h5" />
            </svg>
          </span>
          <span>MediMate</span>
        </Link>

        {/* Desktop navigation */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-3">
          {NAV_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 rounded-btn text-sm font-medium text-ink-secondary hover:text-brand-teal hover:bg-slate-100 transition-colors"
            >
              {item.label}
            </a>
          ))}
          <Link
            to="/login"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 rounded-btn border border-slate-300 bg-surface text-sm font-semibold text-ink-primary hover:bg-slate-50 transition-colors"
          >
            Sign In
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-5 rounded-btn bg-brand-teal text-sm font-semibold text-white hover:bg-brand-teal-dark transition-colors shadow-sm"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-landing-nav"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className="md:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-btn border border-slate-300 bg-surface text-ink-primary hover:bg-slate-50 transition-colors"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
        </button>
      </div>

      {/* Mobile collapsible navigation drawer */}
      <nav
        id="mobile-landing-nav"
        aria-label="Mobile navigation"
        hidden={!mobileMenuOpen}
        className={mobileMenuOpen ? 'md:hidden border-t border-slate-200 bg-surface px-4 py-4' : 'hidden'}
      >
        <div className="flex flex-col gap-3">
          {NAV_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center min-h-[44px] min-w-[44px] px-3 rounded-btn text-base font-medium text-ink-secondary hover:text-brand-teal hover:bg-slate-100 transition-colors"
            >
              {item.label}
            </a>
          ))}
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
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-5 rounded-btn bg-brand-teal text-base font-semibold text-white hover:bg-brand-teal-dark transition-colors shadow-sm"
          >
            Get Started
          </Link>
        </div>
      </nav>
    </header>
  );
}

export default LandingHeader;
