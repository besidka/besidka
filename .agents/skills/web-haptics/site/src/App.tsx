import DesktopView from "./surfaces/desktop-view";
import MobileView from "./surfaces/mobile-view";
import { ParticlesProvider } from "./components/particles";
import { AppProvider } from "./context/app";

function App() {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

  return (
    <AppProvider>
      <ParticlesProvider>
        {isMobile ? <MobileView /> : <DesktopView />}
      </ParticlesProvider>
    </AppProvider>
  );
}

export default App;
