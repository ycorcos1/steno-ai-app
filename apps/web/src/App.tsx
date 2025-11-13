import AppRouter from "./AppRouter";
import { AuthProvider } from "./lib/auth";
import ErrorBoundary from "./components/ErrorBoundary";

const App: React.FC = () => (
  <ErrorBoundary>
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
