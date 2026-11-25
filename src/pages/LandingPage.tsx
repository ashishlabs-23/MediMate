import { LandingHeader } from '../components/landing/LandingHeader';
import { HeroSection } from '../components/landing/HeroSection';
import { LandingSections } from '../components/landing/LandingSections';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink-primary flex flex-col">
      <LandingHeader />
      <main id="main-content" role="main" className="flex-1">
        <HeroSection />
        <LandingSections />
      </main>
    </div>
  );
}

export default LandingPage;
