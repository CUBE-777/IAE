import '../styles/public-home.css';
import '../styles/people.css';
import '../styles/interior-page.css';
import InteriorHeader from '../components/layout/InteriorHeader';
import InteriorFooter from '../components/layout/InteriorFooter';
import Lightbox from '../components/common/Lightbox';
import { useCanonicalUrl } from '../hooks/useCanonicalUrl';

export default function InteriorLayout({ children }) {
  useCanonicalUrl();
  return (
    <>
      <InteriorHeader />
      {children}
      <InteriorFooter />
      <Lightbox />
    </>
  );
}
